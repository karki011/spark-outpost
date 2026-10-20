import { describe, expect, it } from 'vitest';
import { placeTopics } from './topic-model.ts';

const topic = (id: string, at: string) => ({ id, kind: 'topic' as const, at });

describe('placeTopics', () => {
  it('puts each divider before the first turn after it, and the rest at the end', () => {
    const turns = [
      { runId: 'r1', at: '2026-10-20T09:00:00Z' },
      { runId: 'r2', at: '2026-10-20T10:00:00Z' },
    ];
    const placed = placeTopics(
      [
        topic('a', '2026-10-20T09:30:00Z'),
        topic('b', '2026-10-20T09:45:00Z'),
        topic('c', '2026-10-20T11:00:00Z'),
      ],
      turns,
    );
    expect([...placed.before]).toEqual([
      ['r2', [topic('a', '2026-10-20T09:30:00Z'), topic('b', '2026-10-20T09:45:00Z')]],
    ]);
    expect(placed.after.map((entry) => entry.id)).toEqual(['c']);
  });
});
