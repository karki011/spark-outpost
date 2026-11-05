import {
  countsCacheOutsideInput,
  EventType,
  type RunEvent,
  type TokenUsage,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';

type RunFinished = Extract<RunEvent, { type: typeof EventType.RUN_FINISHED }>;
type StandardUsage = NonNullable<RunFinished['usage']>[number];

export interface RecordedUsage {
  provider: string;
  model: string | null;
  tokens: Omit<TokenUsage, 'total'>;
}

export function standardUsage({ provider, model, tokens }: RecordedUsage): StandardUsage {
  const cacheOutside = countsCacheOutsideInput(provider);
  const inputTokens = cacheOutside
    ? tokens.input + (tokens.cachedRead ?? 0) + (tokens.cachedWrite ?? 0)
    : tokens.input;
  const reasoning = tokens.thought !== null && tokens.thought <= tokens.output;
  return {
    provider,
    ...(model ? { model } : {}),
    inputTokens,
    outputTokens: tokens.output,
    totalTokens: inputTokens + tokens.output,
    ...(reasoning ? { reasoningTokens: tokens.thought! } : {}),
    ...(tokens.cachedRead !== null ? { cachedInputTokens: tokens.cachedRead } : {}),
    ...(tokens.cachedWrite !== null ? { cacheWriteInputTokens: tokens.cachedWrite } : {}),
  };
}

interface UsageRow {
  provider: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_read_tokens: number | null;
  cached_write_tokens: number | null;
  thought_tokens: number | null;
}

async function recordedUsage(db: Queryable, runId: string): Promise<RecordedUsage | null> {
  const { rows } = await db.query<UsageRow>(
    `SELECT provider, COALESCE(used_model, model) AS model, input_tokens, output_tokens,
       cached_read_tokens, cached_write_tokens, thought_tokens
     FROM runs WHERE id = $1`,
    [runId],
  );
  const row = rows[0];
  if (!row || row.input_tokens === null || row.output_tokens === null) return null;
  return {
    provider: row.provider,
    model: row.model,
    tokens: {
      input: row.input_tokens,
      output: row.output_tokens,
      cachedRead: row.cached_read_tokens,
      cachedWrite: row.cached_write_tokens,
      thought: row.thought_tokens,
    },
  };
}

export async function withRunUsage(
  db: Queryable,
  runId: string,
  events: readonly RunEvent[],
): Promise<readonly RunEvent[]> {
  if (!events.some((event) => event.type === EventType.RUN_FINISHED)) return events;
  const usage = await recordedUsage(db, runId);
  if (!usage) return events;
  return events.map((event) =>
    event.type === EventType.RUN_FINISHED ? { ...event, usage: [standardUsage(usage)] } : event,
  );
}
