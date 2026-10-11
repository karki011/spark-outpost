import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import { getSnapshot } from '../persistence/run-snapshots.ts';
import type { ProviderOutput } from '../providers/provider.ts';
import {
  runAgentTurn,
  type Append,
  type RunControl,
  type TurnDeps,
  type TurnResult,
} from './agent-turn.ts';
import type { RunInput } from './run-input.ts';

interface RunTotals {
  duration_ms: number | null;
  tool_call_count: number | null;
  cost_usd: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  thought_tokens: number | null;
}

interface Reported {
  cost: boolean;
  tokens: boolean;
}

async function totalsOf(db: Db, runId: string): Promise<RunTotals | null> {
  const { rows } = await db.query<RunTotals>(
    `SELECT duration_ms, tool_call_count, cost_usd::text AS cost_usd, input_tokens, output_tokens,
       total_tokens, cached_read_tokens, cached_write_tokens, thought_tokens
     FROM runs WHERE id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}

const TOKEN_COLUMNS = [
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'cached_read_tokens',
  'cached_write_tokens',
  'thought_tokens',
] as const;

async function addEarlierTotals(db: Db, runId: string, earlier: RunTotals, reported: Reported) {
  const tokens = TOKEN_COLUMNS.map(
    (column, index) =>
      `${column} = CASE WHEN $6 AND $${index + 7}::bigint IS NOT NULL
         THEN COALESCE(${column}, 0) + $${index + 7}::bigint ELSE ${column} END`,
  );
  await db.query(
    `UPDATE runs SET
       duration_ms = COALESCE(duration_ms, 0) + COALESCE($2::bigint, 0),
       tool_call_count = COALESCE(tool_call_count, 0) + COALESCE($3::bigint, 0),
       cost_usd = CASE WHEN $4 AND $5::numeric IS NOT NULL
         THEN COALESCE(cost_usd, 0) + $5::numeric ELSE cost_usd END,
       ${tokens.join(',\n       ')}
     WHERE id = $1`,
    [
      runId,
      earlier.duration_ms,
      earlier.tool_call_count,
      reported.cost,
      earlier.cost_usd,
      reported.tokens,
      ...TOKEN_COLUMNS.map((column) => earlier[column]),
    ],
  );
}

function asSecondPrompt(input: RunInput, prompt: string): RunInput {
  return {
    ...input,
    prompt,
    followUp: null,
    attachments: [],
    askTitle: false,
    modelSwitch: null,
    projectMove: null,
    continuesRunId: null,
    planning: false,
    plansFirst: false,
  };
}

export interface SecondPrompt {
  lease: Lease;
  input: RunInput;
  append: Append;
  control: Pick<RunControl, 'signal' | 'reason' | 'stop'>;
}

export async function promptAgain(
  deps: TurnDeps,
  turn: SecondPrompt,
  prompt: string,
): Promise<TurnResult> {
  const { db } = deps;
  const { runId } = turn.lease;
  const earlier = await totalsOf(db, runId);
  const first = await getSnapshot(db, turn.input.workspaceId, runId);
  const reported: Reported = { cost: false, tokens: false };
  const onProduced = (output: ProviderOutput) => {
    if (output.kind === 'tokens') reported.tokens = true;
    if (output.kind === 'usage' && output.costUsd !== null) reported.cost = true;
  };
  let outcome: TurnResult['outcome'] | null = null;
  try {
    const result = await runAgentTurn(
      { ...deps, browserPane: false },
      turn.lease,
      asSecondPrompt(turn.input, prompt),
      turn.append,
      turn.control,
      { onProduced, keepSnapshot: first?.snapshot ?? undefined, secondPrompt: true },
    );
    outcome = result.outcome;
    return result;
  } finally {
    if (earlier && outcome !== null && outcome !== 'lease_lost') {
      await addEarlierTotals(db, runId, earlier, reported).catch((error: unknown) =>
        console.error("Could not add up the run's two prompts", error),
      );
    }
  }
}
