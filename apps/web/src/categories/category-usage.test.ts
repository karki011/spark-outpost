import { describe, expect, it } from 'vitest';
import type { AuditRunSummary } from '@spark-outpost/contracts';
import { categoryBreakdown, categoryName } from './category-usage.ts';

function run(overrides: Partial<AuditRunSummary>): AuditRunSummary {
  return {
    runId: crypto.randomUUID(),
    userMessageId: crypto.randomUUID(),
    provider: 'claude',
    role: 'Builder',
    runMode: 'do',
    model: null,
    effort: null,
    mode: null,
    status: 'succeeded',
    createdAt: '2026-09-26T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    approvalWaits: [],
    durationMs: null,
    toolCallCount: null,
    inputTokens: null,
    outputTokens: null,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    thoughtTokens: null,
    totalTokens: null,
    costUsd: null,
    costSource: null,
    logEntries: 0,
    logPruned: false,
    methods: [],
    parentRunId: null,
    agentLabel: null,
    category: null,
    ...overrides,
  };
}

describe('category breakdown', () => {
  it('counts turns once, adds child cost to the turn category, and sorts by cost', () => {
    const parent = run({ category: 'debugging', costUsd: 0.1, totalTokens: 100 });
    const rows = categoryBreakdown([
      parent,
      run({ parentRunId: parent.runId, category: 'debugging', costUsd: 0.4, totalTokens: 900 }),
      run({ category: 'docs', costUsd: 0.05, costSource: 'estimated', totalTokens: 50 }),
      run({ category: null, totalTokens: 10 }),
    ]);
    expect(rows).toEqual([
      { category: 'debugging', turns: 1, costUsd: 0.5, costSource: 'reported', totalTokens: 1000 },
      { category: 'docs', turns: 1, costUsd: 0.05, costSource: 'estimated', totalTokens: 50 },
      { category: null, turns: 1, costUsd: null, costSource: null, totalTokens: 10 },
    ]);
  });

  it('names categories for people', () => {
    expect(categoryName('bug_fix')).toBe('Bug fix');
    expect(categoryName(null)).toBe('Uncategorized');
  });
});
