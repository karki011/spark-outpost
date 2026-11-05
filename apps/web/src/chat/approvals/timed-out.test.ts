import { describe, expect, it } from 'vitest';
import {
  askedBeforeTimeout,
  isLatestTurn,
  retryMessage,
  timedOut,
  timedOutText,
} from './timed-out.ts';

const approval = (title: string, status: 'expired' | 'allowed', createdAt: string) => ({
  title,
  status,
  createdAt,
});

describe('approval timeout', () => {
  it('recognises only the timeout as waiting', () => {
    expect(timedOut('Approval timed out')).toBe(true);
    expect(timedOut('The agent hit a problem.')).toBe(false);
    expect(timedOut(null)).toBe(false);
  });

  it('names the last question that expired', () => {
    const asked = askedBeforeTimeout([
      approval('Run git push?', 'expired', '2026-10-06T10:05:00Z'),
      approval('Change a file?', 'allowed', '2026-10-06T10:06:00Z'),
      approval('Run pnpm test?', 'expired', '2026-10-06T10:01:00Z'),
    ]);
    expect(asked).toBe('Run git push?');
    expect(askedBeforeTimeout([approval('Change a file?', 'allowed', '2026')])).toBeNull();
  });

  it('says what was asked and what happened', () => {
    expect(timedOutText('Run git push?')).toBe(
      'Waited 30 minutes for your answer to “Run git push?”, then stopped. Nothing after that step ran.',
    );
    expect(timedOutText(null)).toBe(
      'Waited 30 minutes for your answer, then stopped. Nothing after that step ran.',
    );
    expect(retryMessage('Run git push?')).toContain('“Run git push?” timed out');
  });

  it('offers the retry on the newest turn only', () => {
    const runs = [
      { id: 'a', parentRunId: null },
      { id: 'a1', parentRunId: 'a' },
      { id: 'b', parentRunId: null },
      { id: 'b1', parentRunId: 'b' },
    ];
    const detail = { runs } as unknown as Parameters<typeof isLatestTurn>[0];
    expect(isLatestTurn(detail, 'b')).toBe(true);
    expect(isLatestTurn(detail, 'a')).toBe(false);
  });
});
