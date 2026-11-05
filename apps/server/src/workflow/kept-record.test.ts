import { describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import { acceptCard, checkpointApproval, COMPACT_CARD_TITLE, compactCard } from './kept-record.ts';

describe('the compaction card', () => {
  it('offers compact, a fresh chat and keep going, and goes on by itself', () => {
    const card = compactCard('The context is 92% full.', 95);
    expect(card.kind).toBe('compact');
    expect(card.title).toBe(COMPACT_CARD_TITLE);
    expect(card.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.compactNow,
      CHECKPOINT_OPTION.freshChat,
      CHECKPOINT_OPTION.keepGoing,
    ]);
    expect(card.payload).toMatchObject({
      reason: 'The context is 92% full.',
      autoOption: CHECKPOINT_OPTION.keepGoing,
      askAgainAt: 95,
    });
  });
});

describe('the record of kept changes', () => {
  const files = [{ path: 'src/a.ts', change: 'modified' as const }];

  it('lists the files with keep, fix and revert', () => {
    const card = acceptCard(files, 'Kept by Automatic.');
    expect(card.payload.files).toEqual(files);
    expect(card.options.map((option) => option.optionId)).toEqual([
      CHECKPOINT_OPTION.keep,
      CHECKPOINT_OPTION.fix,
      CHECKPOINT_OPTION.revert,
    ]);
  });

  it('is stored as a card of the run with its own sequence', () => {
    const card = acceptCard(files, 'Kept by Automatic.');
    expect(checkpointApproval('run-1', card, 3)).toMatchObject({
      runId: 'run-1',
      toolCallId: 'checkpoint:accept:3',
      kind: 'accept',
      reason: 'Kept by Automatic.',
      payload: { checkpoint: card.payload },
    });
  });
});
