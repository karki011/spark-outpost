import { describe, expect, it } from 'vitest';
import { needsYouLine, needsYouLines } from '@spark-outpost/contracts';

describe('the Needs you line of a reply', () => {
  it('is found among the closing notes of a reply, wherever it stands', () => {
    const line = needsYouLine('Stopped after 2 retries.');
    expect(line).toBe('Needs you: Stopped after 2 retries.');
    expect(needsYouLines(`Built P1.\n\n${line}\n\nCommitted on spark/x, not pushed.`)).toEqual([
      line,
    ]);
  });

  it('is absent from an ordinary reply', () => {
    expect(needsYouLines('Done. Nobody needs you: it works.')).toEqual([]);
  });
});
