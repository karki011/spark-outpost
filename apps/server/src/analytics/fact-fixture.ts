import type { TurnFact } from './facts.ts';

export function fact(overrides: Partial<TurnFact> = {}): TurnFact {
  return {
    id: 'run',
    day: '2026-09-20',
    project: 'spark-outpost',
    category: 'bug_fix',
    retries: 0,
    roles: ['builder'],
    provider: 'claude',
    model: 'claude-sonnet-5',
    modelLabel: 'Sonnet 5',
    runs: 2,
    tokens: 1000,
    reportedUsd: 0.1,
    estimatedUsd: 0,
    jevUsd: 0,
    verdict: 'good',
    score: 1,
    kept: true,
    reverted: false,
    corrected: false,
    jevAnswered: false,
    wouldApply: null,
    checks: [],
    ...overrides,
  };
}
