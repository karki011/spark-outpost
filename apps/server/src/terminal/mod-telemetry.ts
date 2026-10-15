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
import { estimatedCost } from './turn-usage.ts';

export const MOD_BATCH_MAX = 500;

const label = z.string().min(1).max(200);
const count = z.number().int().nonnegative().max(1_000_000_000);
const at = z.number().int().positive().max(8_640_000_000_000);
const owned = { prompt: label, agent: label.nullable() };

const itemSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('turn_start'), ...owned, turn: label, at }),
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

async function recordItem(db: Db, runId: string, item: ModItem): Promise<void> {
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
): Promise<string[]> {
  const touched = new Set<string>();
  const aborted: string[] = [];
  for (const item of items) {
    const runId = runOf(item.prompt);
    if (!runId) continue;
    await recordItem(db, runId, item);
    if (item.kind !== 'tool') touched.add(runId);
    if (item.kind === 'turn_end' && item.aborted && item.agent === null) aborted.push(item.prompt);
  }
  for (const runId of touched) await saveModUsage(db, runId);
  return aborted;
}
