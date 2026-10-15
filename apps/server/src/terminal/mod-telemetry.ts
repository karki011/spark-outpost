import { z } from 'zod';
import type { Db } from '../persistence/db.ts';
import {
  modOwnsRun,
  modRequestTotals,
  recordModRequest,
  recordModTurn,
  recordModUsage,
  type ModModelTotals,
} from '../persistence/native-terminal-mod-usage.ts';
import { recordNativeStep } from '../persistence/native-terminal-steps.ts';
import { cardPriceFor, type ModelPrice } from '../usage/prices.ts';
import type { ChatRecord } from './chat-record.ts';
import {
  MOD_INPUT_CHARS,
  MOD_OUTPUT_CHARS,
  MOD_REPLY_CHARS,
} from './native-mod-telemetry-script.ts';
import { estimatedCost } from './turn-usage.ts';

export const MOD_BATCH_MAX = 500;

const label = z.string().min(1).max(200);
const count = z.number().int().nonnegative().max(1_000_000_000);
const at = z.number().int().positive().max(8_640_000_000_000);
const owned = { prompt: label, agent: label.nullable() };
const toolInput = z
  .record(z.string(), z.unknown())
  .nullable()
  .refine((input) => JSON.stringify(input).length <= MOD_INPUT_CHARS);

const itemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('turn_start'),
    ...owned,
    turn: label,
    at,
    record: z.literal(true).optional(),
  }),
  z.strictObject({
    kind: z.literal('turn_end'),
    ...owned,
    turn: label,
    at,
    durationMs: count,
    aborted: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('request'),
    ...owned,
    turn: label,
    index: count,
    model: label,
    input: count,
    output: count,
    cacheRead: count,
    cacheWrite: count,
    costUsd: z.number().nonnegative().max(1_000_000).nullable(),
  }),
  z.strictObject({
    kind: z.literal('tool'),
    ...owned,
    id: label,
    name: label,
    phase: z.enum(['start', 'end']),
    failed: z.boolean(),
    at,
    input: toolInput.optional(),
    output: z.string().max(MOD_OUTPUT_CHARS).optional(),
    asked: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('reply'),
    prompt: label,
    agent: z.null(),
    turn: label,
    index: count,
    text: z.string().min(1).max(MOD_REPLY_CHARS),
  }),
]);

export type ModItem = z.infer<typeof itemSchema>;

const batchSchema = z.strictObject({ items: z.array(z.unknown()).max(MOD_BATCH_MAX) });

export function readModTelemetry(body: unknown): ModItem[] | null {
  const batch = batchSchema.safeParse(body);
  if (!batch.success) return null;
  return batch.data.items.flatMap((item) => {
    const parsed = itemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

type PriceFor = (provider: string, model: string | null) => ModelPrice | null;

function totalCost(models: ModModelTotals[], priceFor: PriceFor) {
  if (models.every((entry) => entry.costUsd !== null))
    return { costUsd: sum(models.map((entry) => entry.costUsd!)), reported: true };
  const estimates = models.map((entry) => {
    const price = priceFor('claude', entry.model);
    return price ? estimatedCost(price, { ...entry, cachedWriteLong: 0, thought: 0 }) : null;
  });
  if (estimates.some((cost) => cost === null)) return { costUsd: null, reported: false };
  return { costUsd: sum(estimates as number[]), reported: false };
}

function sum(values: number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 1_000_000) / 1_000_000;
}

function countOf(
  models: ModModelTotals[],
  key: 'input' | 'output' | 'cachedRead' | 'cachedWrite',
): number {
  return models.reduce((total, entry) => total + entry[key], 0);
}

export async function saveModUsage(
  db: Db,
  runId: string,
  priceFor: PriceFor = cardPriceFor,
): Promise<void> {
  if (!(await modOwnsRun(db, runId))) return;
  const models = await modRequestTotals(db, runId);
  if (models.length === 0) return;
  const tokens = {
    input: countOf(models, 'input'),
    output: countOf(models, 'output'),
    cachedRead: countOf(models, 'cachedRead'),
    cachedWrite: countOf(models, 'cachedWrite'),
  };
  const { costUsd, reported } = totalCost(models, priceFor);
  await recordModUsage(
    db,
    runId,
    {
      model: models.at(-1)!.model,
      tokens: {
        ...tokens,
        total: tokens.input + tokens.output + tokens.cachedRead + tokens.cachedWrite,
        thought: null,
      },
      costUsd,
    },
    reported,
  );
}

export type ChatRecordFor = (runId: string) => Promise<ChatRecord | null>;

async function recordDetail(record: ChatRecord | null, item: ModItem): Promise<void> {
  if (!record) return;
  if (item.kind === 'reply') return record.replied(`${item.turn}:${item.index}`, item.text);
  if (item.kind !== 'tool') return;
  if (item.phase === 'start' && item.input !== undefined)
    return record.toolStarted({ id: item.id, name: item.name, input: item.input });
  if (item.phase === 'end' && item.output !== undefined)
    return record.toolEnded({
      id: item.id,
      output: item.output,
      failed: item.failed,
      asked: item.asked === true,
    });
}

function detailed(item: ModItem): boolean {
  if (item.kind === 'turn_start') return item.record === true && item.agent === null;
  return item.kind === 'reply' || (item.kind === 'tool' && ('input' in item || 'output' in item));
}

async function recordItem(db: Db, runId: string, item: ModItem): Promise<void> {
  if (item.kind === 'reply') return;
  const agentId = item.agent;
  if (item.kind === 'turn_start' || item.kind === 'turn_end') {
    await recordModTurn(db, runId, {
      turnId: item.turn,
      agentId,
      phase: item.kind === 'turn_start' ? 'start' : 'end',
      at: new Date(item.at),
      ...(item.kind === 'turn_end' ? { durationMs: item.durationMs, aborted: item.aborted } : {}),
    });
    return;
  }
  if (item.kind === 'request') {
    await recordModRequest(db, runId, {
      turnId: item.turn,
      index: item.index,
      agentId,
      model: item.model,
      input: item.input,
      output: item.output,
      cachedRead: item.cacheRead,
      cachedWrite: item.cacheWrite,
      costUsd: item.costUsd,
    });
    return;
  }
  await recordNativeStep(db, runId, {
    id: item.id,
    name: item.name,
    phase: item.phase,
    failed: item.failed,
    at: new Date(item.at),
    ...(agentId ? { agentId } : {}),
  });
}

export async function recordModTelemetry(
  db: Db,
  runOf: (promptId: string) => string | null,
  items: readonly ModItem[],
  chatRecordFor: ChatRecordFor = async () => null,
): Promise<string[]> {
  const touched = new Set<string>();
  const aborted: string[] = [];
  for (const item of items) {
    const runId = runOf(item.prompt);
    if (!runId) continue;
    await recordItem(db, runId, item);
    if (detailed(item)) await recordDetail(await chatRecordFor(runId), item);
    if (item.kind !== 'tool' && item.kind !== 'reply') touched.add(runId);
    if (item.kind === 'turn_end' && item.aborted && item.agent === null) aborted.push(item.prompt);
  }
  for (const runId of touched) await saveModUsage(db, runId);
  return aborted;
}
