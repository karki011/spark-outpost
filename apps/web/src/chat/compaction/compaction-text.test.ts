import { describe, expect, it } from 'vitest';
import type { Compaction } from '@spark-outpost/contracts';
import { compactionTitle, compactionsByRun, tokensLine } from './compaction-text.ts';

const base: Compaction = {
  id: '00000000-0000-4000-8000-000000000001',
  runId: '00000000-0000-4000-8000-0000000000a1',
  method: 'agent',
  tokensBefore: 172_000,
  tokensAfter: 18_000,
  contextSize: 200_000,
  summary: null,
  fromConversationId: null,
  fromTitle: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

describe('compaction divider text', () => {
  it('names who compacted', () => {
    expect(compactionTitle(base)).toBe('Compacted');
    expect(compactionTitle({ ...base, method: 'spark' })).toBe('Compacted with a Spark summary');
    expect(compactionTitle({ ...base, method: 'agent-auto' })).toBe(
      'The agent compacted its context',
    );
    expect(
      compactionTitle({
        ...base,
        method: 'spark',
        fromConversationId: '00000000-0000-4000-8000-0000000000c1',
        fromTitle: 'Ledger fixes',
      }),
    ).toBe('Started from a summary of Ledger fixes');
  });

  it('shows tokens before and after when known', () => {
    expect(tokensLine(base)).toBe('172K → 18K tokens');
    expect(tokensLine({ ...base, tokensAfter: null })).toBe('172K tokens before');
    expect(tokensLine({ ...base, tokensBefore: null })).toBeNull();
  });

  it('groups by run and skips compactions without one', () => {
    const second = { ...base, id: '00000000-0000-4000-8000-000000000002' };
    const byRun = compactionsByRun([base, second, { ...base, runId: null }]);
    expect(byRun.get(base.runId!)?.map((entry) => entry.id)).toEqual([base.id, second.id]);
    expect(byRun.size).toBe(1);
    expect(compactionsByRun(undefined).size).toBe(0);
  });
});
