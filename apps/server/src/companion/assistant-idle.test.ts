import { describe, expect, it } from 'vitest';
import { ASSISTANT_IDLE_COMPACT_MS, idleCompactDue, type IdleFacts } from './assistant-idle.ts';

const ANSWERED = new Date('2026-10-15T10:00:00Z');
const FACTS: IdleFacts = {
  lastAnsweredAt: ANSWERED,
  busy: false,
  compactedSince: false,
  autoCompact: true,
  reading: { used: 40_000, size: 200_000 },
};
const after = (minutes: number) => new Date(ANSWERED.getTime() + minutes * 60_000);

describe('idle compaction of the Ask Spark session', () => {
  it('runs once 15 minutes pass after the last answer', () => {
    expect(idleCompactDue(FACTS, after(14), ASSISTANT_IDLE_COMPACT_MS)).toBe(false);
    expect(idleCompactDue(FACTS, after(15), ASSISTANT_IDLE_COMPACT_MS)).toBe(true);
  });

  it('waits for a small context, a quiet chat, automatic compaction and a new answer', () => {
    const late = after(60);
    const small = { ...FACTS, reading: { used: 10_000, size: 200_000 } };
    expect(idleCompactDue(small, late, ASSISTANT_IDLE_COMPACT_MS)).toBe(false);
    expect(idleCompactDue({ ...FACTS, busy: true }, late, ASSISTANT_IDLE_COMPACT_MS)).toBe(false);
    expect(idleCompactDue({ ...FACTS, autoCompact: false }, late, ASSISTANT_IDLE_COMPACT_MS)).toBe(
      false,
    );
    expect(
      idleCompactDue({ ...FACTS, compactedSince: true }, late, ASSISTANT_IDLE_COMPACT_MS),
    ).toBe(false);
    expect(idleCompactDue({ ...FACTS, reading: null }, late, ASSISTANT_IDLE_COMPACT_MS)).toBe(
      false,
    );
  });
});
