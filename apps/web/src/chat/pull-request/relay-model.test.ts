import { describe, expect, it } from 'vitest';
import { roundOutcomeLine, type RoundOutcome } from '@spark-outpost/contracts';
import { outcomesIn, turnOutcomeLine } from './relay-model.ts';
import { RUN, watch } from './watch-fixture.ts';
import { watchIndicator } from './watch-indicator-model.ts';

const OTHER_RUN = '0190d7a0-0000-7000-8000-000000000002';

const outcome = (fields: Partial<RoundOutcome> = {}): RoundOutcome => ({
  runId: RUN,
  round: 1,
  ended: 'settled',
  pushed: false,
  merged: false,
  replied: 0,
  rerequested: false,
  needs: 0,
  unpushed: false,
  ...fields,
});

describe('what Relay did in a round', () => {
  it('lists replies, the push and a re-request, in that order', () => {
    const line = roundOutcomeLine(
      'Relay',
      outcome({ replied: 3, pushed: true, rerequested: true }),
    );
    expect(line).toBe('Relay replied to 3 comments, pushed a fix, re-requested review');
  });

  it('says it stopped when a round changed nothing, and what is left', () => {
    expect(roundOutcomeLine('Relay', outcome())).toBe('Relay stopped: nothing changed');
    expect(roundOutcomeLine('Relay', outcome({ needs: 2 }))).toBe(
      'Relay stopped: nothing changed; 2 items need you',
    );
  });

  it('names a merge of the base, an unpushed fix, a stopped and an unfinished round', () => {
    expect(roundOutcomeLine('Relay', outcome({ pushed: true, merged: true }))).toBe(
      'Relay merged the base and pushed',
    );
    expect(roundOutcomeLine('Relay', outcome({ unpushed: true }))).toBe(
      'Relay made a fix that was not pushed',
    );
    expect(roundOutcomeLine('Relay', outcome({ ended: 'stopped' }))).toBe(
      "Relay's round was stopped",
    );
    expect(roundOutcomeLine('Relay', outcome({ ended: 'failed' }))).toBe(
      "Relay's round did not finish",
    );
  });

  it('finds the outcomes of a turn and uses the current name', () => {
    const watched = watch({
      roundOutcomes: [outcome({ replied: 1 }), outcome({ runId: OTHER_RUN })],
    });
    const found = outcomesIn([watched], [RUN]);
    expect(found).toHaveLength(1);
    expect(turnOutcomeLine('Courier', found[0]!)).toBe('Courier replied to 1 comment on #7.');
    expect(outcomesIn([watch()], [RUN])).toEqual([]);
  });
});

describe('the PR row names Relay', () => {
  const base = { mode: 'on' as const, worker: null, now: 0 };

  it('says Relay is on it during a round and stopped after a quiet round', () => {
    const running = watchIndicator(watch({ phase: 'fixing', rounds: 1 }), {
      ...base,
      relay: 'Courier',
    });
    expect(running).toMatchObject({ label: 'Courier is on it', short: 'Courier is on it' });
    const quiet = watchIndicator(watch({ quiet: true, review: 'approved' }), {
      ...base,
      relay: 'Courier',
    });
    expect(quiet?.label).toBe('Courier stopped: nothing changed');
  });

  it('leads with the last round while watching, and keeps the old words without Relay', () => {
    const watched = watch({
      review: 'approved',
      roundOutcomes: [outcome({ replied: 2, pushed: true })],
    });
    const named = watchIndicator(watched, { ...base, relay: 'Relay' });
    expect(named?.lines[0]).toBe('Relay replied to 2 comments, pushed a fix.');
    const plain = watchIndicator(watched, base);
    expect(plain?.label).toBe('Spark is watching');
    expect(plain?.lines[0]).toBe('Spark is watching checks and reviews.');
    expect(watchIndicator(watch({ phase: 'fixing', rounds: 1 }), base)?.label).toBe(
      'Agent is on it',
    );
  });
});
