import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { COMPACTED_LINE, COMPACTION_FAILED_LINE } from './compaction-lines.ts';
import { createUpdateMapper } from './session-updates.ts';

const compaction = (compactionId: string, status: string, error?: string): SessionUpdate => ({
  sessionUpdate: 'compaction_update',
  compactionId,
  status,
  ...(error ? { error } : {}),
});

const summaryChunk = (compactionId: string, text: string): SessionUpdate => ({
  sessionUpdate: 'compaction_summary_chunk',
  compactionId,
  content: { type: 'text', text },
});

const lines = (outputs: readonly ProviderOutput[]) =>
  outputs.flatMap((output) => (output.kind === 'step_started' ? [output.name] : []));

function mapAll(updates: readonly SessionUpdate[]) {
  const mapper = createUpdateMapper();
  const outputs = updates.flatMap((update) => mapper.map(update));
  return { mapper, outputs };
}

describe('ACP compaction updates', () => {
  it('shows one plain line when a compaction completes, and never the summary as reply text', () => {
    const { mapper, outputs } = mapAll([
      compaction('c1', 'in_progress'),
      summaryChunk('c1', 'The user asked for a parser.'),
      compaction('c1', 'completed'),
    ]);
    expect(lines(outputs)).toEqual([COMPACTED_LINE]);
    expect(outputs.some((output) => output.kind === 'text_delta')).toBe(false);
    expect(mapper.repliedWithText()).toBe(false);
    expect(mapper.didWork()).toBe(true);
  });

  it('shows a repeated or late terminal update for the same compaction once', () => {
    const { outputs } = mapAll([
      compaction('c1', 'completed'),
      compaction('c1', 'completed'),
      compaction('c2', 'cancelled'),
      compaction('c2', 'completed'),
      compaction('c3', 'failed', 'too large'),
      compaction('c3', 'completed'),
    ]);
    expect(lines(outputs)).toEqual([COMPACTED_LINE, `${COMPACTION_FAILED_LINE}: too large`]);
  });

  it('gives each compaction in a turn its own line', () => {
    const { outputs } = mapAll([compaction('c1', 'completed'), compaction('c2', 'completed')]);
    expect(lines(outputs)).toEqual([COMPACTED_LINE, COMPACTED_LINE]);
  });

  it('shows a failure without a reason, and nothing for a cancelled or unknown status', () => {
    const { outputs } = mapAll([
      compaction('c1', 'failed'),
      compaction('c2', 'cancelled'),
      compaction('c3', 'paused'),
    ]);
    expect(lines(outputs)).toEqual([COMPACTION_FAILED_LINE]);
  });

  it('counts only a completed compaction as work', () => {
    for (const updates of [
      [compaction('c1', 'in_progress')],
      [compaction('c1', 'cancelled')],
      [compaction('c1', 'paused')],
      [compaction('c1', 'failed', 'too large')],
    ]) {
      expect(mapAll(updates).mapper.didWork()).toBe(false);
    }
    expect(
      mapAll([compaction('c1', 'completed'), compaction('c1', 'completed')]).mapper.didWork(),
    ).toBe(true);
  });
});
