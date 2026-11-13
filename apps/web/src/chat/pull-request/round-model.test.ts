import { describe, expect, it } from 'vitest';
import { roundOutcomeLine, type RoundOutcome } from '@spark-outpost/contracts';
import { outcomesIn, turnOutcomeLine } from './round-model.ts';
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

describe('what a follow-up round did', () => {
  it('lists replies, the push and a re-request, in that order', () => {
    const line = roundOutcomeLine(outcome({ replied: 3, pushed: true, rerequested: true }));
    expect(line).toBe('Follow-up replied to 3 comments, pushed a fix, re-requested review');
  });

  it('says it stopped when a round changed nothing, and what is left', () => {
    expect(roundOutcomeLine(outcome())).toBe('Follow-up stopped: nothing changed');
    expect(roundOutcomeLine(outcome({ needs: 2 }))).toBe(
      'Follow-up stopped: nothing changed; 2 items need you',
    );
  });

  it('names a merge of the base, an unpushed fix, a stopped and an unfinished round', () => {
    expect(roundOutcomeLine(outcome({ pushed: true, merged: true }))).toBe(
      'Follow-up merged the base and pushed',
    );
    expect(roundOutcomeLine(outcome({ unpushed: true }))).toBe(
      'Follow-up made a fix that was not pushed',
    );
    expect(roundOutcomeLine(outcome({ ended: 'stopped' }))).toBe('Follow-up round was stopped');
    expect(roundOutcomeLine(outcome({ ended: 'failed' }))).toBe('Follow-up round did not finish');
  });

  it('finds the outcomes of a turn', () => {
    const watched = watch({
      roundOutcomes: [outcome({ replied: 1 }), outcome({ runId: OTHER_RUN })],
    });
    const found = outcomesIn([watched], [RUN]);
    expect(found).toHaveLength(1);
    expect(turnOutcomeLine(found[0]!)).toBe('Follow-up replied to 1 comment on #7.');
    expect(outcomesIn([watch()], [RUN])).toEqual([]);
  });
});

describe('the PR row and the last round', () => {
  const base = { mode: 'on' as const, worker: null, now: 0 };

  it('says the agent is on it during a round and stopped after a quiet round', () => {
    const running = watchIndicator(watch({ phase: 'fixing', rounds: 1 }), base);
    expect(running).toMatchObject({ label: 'Agent is on it', short: 'Agent is on it' });
    const quiet = watchIndicator(watch({ quiet: true, review: 'approved' }), base);
    expect(quiet?.label).toBe('Stopped following up');
  });

  it('leads with the last round while watching, and with the watch line when there is none', () => {
    const watched = watch({
      review: 'approved',
      roundOutcomes: [outcome({ replied: 2, pushed: true })],
    });
    const led = watchIndicator(watched, base);
    expect(led?.label).toBe('Spark is watching');
    expect(led?.lines[0]).toBe('Follow-up replied to 2 comments, pushed a fix.');
    const plain = watchIndicator(watch({ review: 'approved' }), base);
    expect(plain?.lines[0]).toBe('Spark is watching checks and reviews.');
  });
});
