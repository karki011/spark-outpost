import { describe, expect, it } from 'vitest';
import type { Orchestration, Run } from '@spark-outpost/contracts';
import {
  compactCost,
  contextPercent,
  costNote,
  costTip,
  formatCost,
  latestContext,
  taskContext,
  runUsageLine,
  tokenBreakdown,
  usageLine,
} from './format.ts';

const tokens = {
  input: 900,
  output: 300,
  total: 1200,
  cachedRead: 600,
  cachedWrite: null,
  thought: 0,
};

describe('formatCost', () => {
  it('keeps small costs readable without false precision', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0004)).toBe('<$0.001');
    expect(formatCost(0.0042)).toBe('$0.004');
    expect(formatCost(0.034)).toBe('$0.03');
    expect(formatCost(12.5)).toBe('$12.50');
  });
});

describe('estimated costs', () => {
  it('marks an estimate with a tilde and leaves reported costs alone', () => {
    expect(formatCost(0.034, 'estimated')).toBe('~$0.03');
    expect(formatCost(0.0004, 'estimated')).toBe('~<$0.001');
    expect(formatCost(0.034, 'reported')).toBe('$0.03');
    expect(formatCost(0.034, 'mixed')).toBe('$0.03');
    expect(formatCost(0.034, null)).toBe('$0.03');
  });

  it('says when a total includes estimates', () => {
    expect(usageLine(1200, 0.0042, 'estimated')).toBe('1.2K tokens · ~$0.004');
    expect(usageLine(1200, 0.02, 'mixed')).toBe('1.2K tokens · $0.02 · includes estimates');
    expect(usageLine(1200, null, 'mixed')).toBe('1.2K tokens');
    expect(
      runUsageLine({
        contextUsed: null,
        contextSize: null,
        costUsd: 0.5,
        costSource: 'estimated',
        tokens,
      }),
    ).toBe('1.2K tokens · ~$0.50');
  });

  it('marks a row that includes estimates with a tilde and keeps the long words for totals', () => {
    expect(compactCost(1.71, 'mixed')).toBe('~$1.71');
    expect(compactCost(0.0004, 'estimated')).toBe('~<$0.001');
    expect(compactCost(5.83, 'reported')).toBe('$5.83');
    expect(compactCost(5.83, null)).toBe('$5.83');
    expect(formatCost(1.71, 'mixed')).toBe('$1.71');
  });

  it('explains estimates only when there is one', () => {
    expect(costNote('estimated')).toBe('estimated');
    expect(costNote('mixed')).toBe('includes estimates');
    expect(costNote('reported')).toBeNull();
    expect(costTip('estimated')).toMatch(/list price/);
    expect(costTip('mixed')).toMatch(/estimated/);
    expect(costTip(undefined)).toBeUndefined();
  });
});

describe('usage lines', () => {
  it('joins tokens and cost and omits what was not reported', () => {
    expect(usageLine(1200, 0.0042)).toBe('1.2K tokens · $0.004');
    expect(usageLine(1200, null)).toBe('1.2K tokens');
    expect(usageLine(null, 0.02)).toBe('$0.02');
    expect(usageLine(null, null)).toBeNull();
  });

  it('describes a run from its usage', () => {
    expect(runUsageLine(null)).toBeNull();
    expect(
      runUsageLine({ contextUsed: 10, contextSize: 100, costUsd: null, tokens: null }),
    ).toBeNull();
    expect(runUsageLine({ contextUsed: null, contextSize: null, costUsd: null, tokens })).toBe(
      '1.2K tokens',
    );
  });

  it('lists only the token kinds that were used', () => {
    expect(tokenBreakdown(tokens)).toEqual(['Input 900', 'Output 300', 'Cached read 600']);
  });
});

describe('contextPercent', () => {
  it('rounds and caps the share of the window', () => {
    expect(contextPercent(12_000, 200_000)).toBe(6);
    expect(contextPercent(300, 200)).toBe(100);
    expect(contextPercent(null, 200)).toBe(0);
    expect(contextPercent(5, 0)).toBe(0);
  });
});

describe('latestContext', () => {
  const run = (provider: string, contextUsed: number | null): Run => ({
    id: crypto.randomUUID(),
    conversationId: crypto.randomUUID(),
    userMessageId: crypto.randomUUID(),
    provider,
    status: 'succeeded',
    error: null,
    cancelRequested: false,
    createdAt: '2026-09-25T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    model: null,
    effort: null,
    usage:
      contextUsed === null ? null : { contextUsed, contextSize: 1000, costUsd: null, tokens: null },
    mode: null,
    level: null,
    snapshot: null,
    revertedAt: null,
  });

  it('prefers the current provider and skips runs without context', () => {
    const runs = [run('claude', 100), run('codex', 400), run('claude', 200), run('claude', null)];
    expect(latestContext(runs, 'claude')).toEqual({ used: 200, size: 1000 });
    expect(latestContext(runs, 'codex')).toEqual({ used: 400, size: 1000 });
  });

  it('falls back to the latest reading when the provider has not run yet', () => {
    expect(latestContext([run('codex', 400), run('claude', null)], 'fake')).toEqual({
      used: 400,
      size: 1000,
    });
    expect(latestContext([], null)).toBeNull();
  });
});

describe('taskContext', () => {
  const member = (role: string, contextUsed: number | null) => ({
    role,
    name: role === 'builder' ? 'Bolt' : 'Scout',
    contextUsed,
    contextSize: contextUsed === null ? null : 1000,
  });
  const orchestration = (status: string, crew: ReturnType<typeof member>[]) =>
    ({ status, crew }) as unknown as Orchestration;

  it('reads the latest Builder while the task runs', () => {
    const active = orchestration('running', [member('builder', 340), member('critic', 900)]);
    expect(taskContext(active)).toEqual({ name: 'Bolt', used: 340, size: 1000 });
  });

  it('gives the ring back to the chat once the task is idle or has no reading', () => {
    expect(taskContext(orchestration('succeeded', [member('builder', 340)]))).toBeNull();
    expect(taskContext(orchestration('running', [member('builder', null)]))).toBeNull();
    expect(taskContext(null)).toBeNull();
  });
});
