import { z } from 'zod';
import {
  measuredSeedSchema,
  providerIdSchema,
  type CardCategory,
  type ModelStat,
  type StatRole,
} from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { replaceRound, upsertModelStats } from '../persistence/model-stats.ts';
import { cardFor } from './cards.ts';
import seedJson from './measured-seed.json' with { type: 'json' };

const benchAgentSchema = z.object({
  role: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  costUsd: z.number(),
  costSource: z.string().nullable(),
  durationMs: z.number(),
});

const benchResultSchema = z.object({
  task: z.string(),
  startedAt: z.string(),
  agents: z.array(benchAgentSchema),
  verification: z.object({ passed: z.boolean() }),
});

export const benchRoundSchema = z.object({
  date: z.string(),
  results: z.array(benchResultSchema),
});
export type BenchRound = z.infer<typeof benchRoundSchema>;

const ROLE_OF: Readonly<Record<string, StatRole>> = {
  agent: 'direct',
  scout: 'scout',
  architect: 'architect',
  builder: 'builder',
  critic: 'critic',
};

interface Sample {
  passed: boolean;
  costUsd: number;
  costSource: string;
  durationMs: number;
  shared: boolean;
}

export interface IngestResult {
  stats: ModelStat[];
  skipped: string[];
}

function categoryOf(
  role: StatRole,
  task: string,
  categories: Readonly<Record<string, CardCategory>>,
): CardCategory | null {
  if (role === 'architect') return 'plan';
  if (role === 'critic') return 'review';
  return categories[task] ?? null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function statsFromRound(
  round: BenchRound,
  file: string,
  categories: Readonly<Record<string, CardCategory>>,
): IngestResult {
  const groups = new Map<
    string,
    {
      stat: Omit<
        ModelStat,
        'n' | 'passed' | 'meanCostUsd' | 'costSource' | 'meanWallMs' | 'sharedCredit'
      >;
      samples: Sample[];
    }
  >();
  const skipped = new Set<string>();
  for (const result of round.results) {
    for (const agent of result.agents) {
      const role = ROLE_OF[agent.role];
      const provider = providerIdSchema.safeParse(agent.provider);
      const category = role ? categoryOf(role, result.task, categories) : null;
      const card =
        provider.success && agent.model ? cardFor({ id: agent.model }, provider.data) : null;
      if (!role || !provider.success || !category || !card || !agent.model) {
        skipped.add(`${result.task} ${agent.role} ${agent.provider}/${agent.model ?? '?'}`);
        continue;
      }
      const key = [provider.data, agent.model, agent.effort ?? '', role, category].join('|');
      const group = groups.get(key) ?? {
        stat: {
          source: 'benchmark' as const,
          round: round.date,
          measuredOn: result.startedAt.slice(0, 10),
          file,
          provider: provider.data,
          model: card.id,
          agentModel: agent.model,
          effort: agent.effort,
          role,
          category,
        },
        samples: [],
      };
      group.samples.push({
        passed: result.verification.passed,
        costUsd: agent.costUsd,
        costSource: agent.costSource ?? 'none',
        durationMs: agent.durationMs,
        shared: result.agents.length > 1,
      });
      groups.set(key, group);
    }
  }
  const stats = [...groups.values()].map(({ stat, samples }) => {
    const sources = new Set(samples.map((sample) => sample.costSource));
    return {
      ...stat,
      n: samples.length,
      passed: samples.filter((sample) => sample.passed).length,
      meanCostUsd: Number(mean(samples.map((sample) => sample.costUsd)).toFixed(4)),
      costSource: sources.size === 1 ? [...sources][0]! : 'mixed',
      meanWallMs: Math.round(mean(samples.map((sample) => sample.durationMs))),
      sharedCredit: samples.filter((sample) => sample.shared).length,
    };
  });
  return { stats, skipped: [...skipped] };
}

export async function ingestRound(
  db: Queryable,
  round: BenchRound,
  file: string,
  categories: Readonly<Record<string, CardCategory>>,
): Promise<IngestResult> {
  const result = statsFromRound(round, file, categories);
  await replaceRound(db, 'benchmark', round.date, result.stats);
  return result;
}

export const MEASURED_SEED = measuredSeedSchema.parse(seedJson);

export async function seedModelStats(db: Queryable): Promise<number> {
  return upsertModelStats(db, MEASURED_SEED.stats);
}
