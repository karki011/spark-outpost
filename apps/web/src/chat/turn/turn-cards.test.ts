import { describe, expect, it } from 'vitest';
import type { RailFlag } from '@spark-outpost/contracts';
import { approval } from '../approvals/test-approval.ts';
import { turnCards } from './turn-cards.ts';

const flag: RailFlag = {
  id: '7f3c1a2e-0c4b-4a61-9a4e-0d1f2c3b4a5d',
  runId: approval.runId,
  turnRunId: approval.runId,
  rail: 'sent_out',
  title: 'Claude sent data out through git push',
  paths: [],
  inside: false,
  originals: [],
  status: 'open',
  createdAt: '2026-09-26T10:05:00.000Z',
};

const asked = { ...approval, status: 'allowed' as const, createdAt: '2026-09-26T10:00:00.000Z' };

describe('turn cards', () => {
  it('marks cards for the timeline and keeps the text offset seen when one arrived', () => {
    const cards = turnCards({
      approvals: [asked],
      flags: [flag],
      approvalAt: { [asked.id]: 12 },
      publishFrom: null,
    });
    expect(cards.marks).toEqual([
      { id: asked.id, time: Date.parse(asked.createdAt), textOffset: 12 },
      { id: flag.id, time: Date.parse(flag.createdAt), textOffset: undefined },
    ]);
    expect(cards.publish).toEqual([]);
  });

  it('moves cards raised after the reply closed to the publish step', () => {
    const cards = turnCards({
      approvals: [asked],
      flags: [flag],
      approvalAt: {},
      publishFrom: Date.parse('2026-09-26T10:02:00.000Z'),
    });
    expect(cards.marks.map((mark) => mark.id)).toEqual([asked.id]);
    expect(cards.publish.map((card) => card.id)).toEqual([flag.id]);
  });

  it('shows a card once when it is listed twice', () => {
    const cards = turnCards({
      approvals: [asked, asked],
      flags: [],
      approvalAt: {},
      publishFrom: null,
    });
    expect(cards.marks).toHaveLength(1);
  });
});
