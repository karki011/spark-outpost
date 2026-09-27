import { describe, expect, it } from 'vitest';
import { statsFromRound, type BenchRound } from './ingest.ts';

const agent = (
  role: string,
  provider: string,
  model: string,
  costUsd: number,
  durationMs: number,
) => ({
  role,
  provider,
  model,
  effort: role === 'architect' ? 'high' : 'medium',
  costUsd,
  costSource: provider === 'codex' ? 'estimated' : 'reported',
  durationMs,
});

const round: BenchRound = {
  date: '2026-10-01-r5',
  results: [
    {
      task: 'T2',
      startedAt: '2026-10-01T10:00:00Z',
      agents: [agent('agent', 'claude', 'sonnet', 0.08, 20_000)],
      verification: { passed: true },
    },
    {
      task: 'T2',
      startedAt: '2026-10-01T10:05:00Z',
      agents: [agent('agent', 'claude', 'sonnet', 0.1, 30_000)],
      verification: { passed: false },
    },
    {
      task: 'H2',
      startedAt: '2026-10-01T11:00:00Z',
      agents: [
        agent('architect', 'claude', 'opus[1m]', 0.2, 40_000),
        agent('builder', 'claude', 'haiku', 0.03, 12_000),
        agent('critic', 'codex', 'gpt-6-sol', 0.004, 30_000),
      ],
      verification: { passed: true },
    },
    {
      task: 'ZZ',
      startedAt: '2026-10-01T12:00:00Z',
      agents: [agent('builder', 'claude', 'mystery-model', 1, 1)],
      verification: { passed: true },
    },
  ],
};

describe('benchmark ingest', () => {
  it('groups agents by model, effort, role and category, with pass, cost and time', () => {
    const { stats, skipped } = statsFromRound(round, 'docs/benchmarks/r5.json', {
      T2: 'fix',
      H2: 'refactor',
    });
    expect(stats).toContainEqual(
      expect.objectContaining({
        round: '2026-10-01-r5',
        measuredOn: '2026-10-01',
        model: 'claude-sonnet-5',
        agentModel: 'sonnet',
        role: 'direct',
        category: 'fix',
        n: 2,
        passed: 1,
        meanCostUsd: 0.09,
        meanWallMs: 25_000,
        sharedCredit: 0,
      }),
    );
    expect(stats).toContainEqual(
      expect.objectContaining({
        model: 'claude-opus-5-5',
        role: 'architect',
        category: 'plan',
        sharedCredit: 1,
      }),
    );
    expect(stats).toContainEqual(
      expect.objectContaining({ model: 'claude-haiku-4-5', role: 'builder', category: 'refactor' }),
    );
    expect(stats).toContainEqual(
      expect.objectContaining({
        model: 'gpt-6-sol',
        role: 'critic',
        category: 'review',
        costSource: 'estimated',
      }),
    );
    expect(stats).toHaveLength(4);
    expect(skipped).toEqual(['ZZ builder claude/mystery-model']);
  });
});
