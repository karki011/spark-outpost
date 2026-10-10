import { describe, expect, it } from 'vitest';
import { deriveSignals, followUpWindowClosed, outcomeKind, type TurnFacts } from './derive.ts';

const finished = new Date('2026-09-20T10:00:00Z');
const minutes = (count: number) => new Date(finished.getTime() + count * 60_000);

function facts(overrides: Partial<TurnFacts> = {}): TurnFacts {
  return {
    runId: 'run',
    taskId: 'task',
    status: 'succeeded',
    finishedAt: finished,
    revertedAt: null,
    depth: 'execute',
    request: 'Move the date helpers into one module',
    changedFiles: true,
    accepts: [],
    checks: null,
    followUps: [],
    ...overrides,
  };
}

const kindsOf = (turn: TurnFacts, now = minutes(5)) =>
  deriveSignals(turn, now).map((signal) => `${signal.kind}:${signal.source}`);

describe('outcome kind', () => {
  it('is a change once the keep card was answered with Keep or Revert', () => {
    expect(outcomeKind(facts({ accepts: [{ optionId: 'keep', decidedAt: finished }] }))).toBe(
      'change',
    );
    expect(outcomeKind(facts({ accepts: [{ optionId: 'fix', decidedAt: finished }] }))).toBe(
      'other',
    );
  });

  it('is an answer for a direct turn that changed nothing', () => {
    expect(outcomeKind(facts({ depth: 'direct', changedFiles: false }))).toBe('answer');
    expect(outcomeKind(facts({ depth: 'direct', status: 'failed' }))).toBe('other');
    expect(outcomeKind(facts({ depth: null, changedFiles: false }))).toBe('answer');
    expect(outcomeKind(facts({ depth: null, changedFiles: true }))).toBe('other');
  });
});

describe('derived signals', () => {
  it('records keep, fix and checks with their sources', () => {
    const turn = facts({
      accepts: [
        { optionId: 'fix', decidedAt: minutes(-5) },
        { optionId: 'keep', decidedAt: minutes(-1) },
      ],
      checks: { status: 'passed', at: minutes(-2) },
    });
    expect(kindsOf(turn)).toEqual(['correction:user', 'kept:user', 'checks_passed:harness']);
  });

  it('records a revert from the button after the run', () => {
    expect(kindsOf(facts({ revertedAt: minutes(30) }))).toEqual(['reverted:user']);
  });

  it('records failed and cancelled runs', () => {
    expect(kindsOf(facts({ status: 'outcome_unknown' }))).toEqual(['failed:harness']);
    expect(kindsOf(facts({ status: 'cancelled' }))).toEqual(['cancelled:harness']);
  });

  it('classifies only the next turn in the chat, once its intake is known', () => {
    const next = {
      runId: 'next',
      text: 'that is wrong, put it back',
      category: null,
      classified: false,
      sameChat: true,
      createdAt: minutes(10),
    };
    const later = { ...next, runId: 'later', text: "that's wrong", createdAt: minutes(20) };
    expect(kindsOf(facts({ followUps: [next, later] }), minutes(30))).toEqual([]);
    const signals = deriveSignals(
      facts({
        followUps: [
          { ...next, classified: true },
          { ...later, classified: true },
        ],
      }),
      minutes(30),
    );
    expect(signals.map((signal) => signal.kind)).toEqual(['correction']);
    expect(signals[0]!.detail).toMatchObject({ followUpRunId: 'next', gapMinutes: 10 });
  });

  it('adds quiet_24h only after a quiet day', () => {
    const day = 24 * 60;
    expect(kindsOf(facts(), minutes(day - 1))).toEqual([]);
    expect(kindsOf(facts(), minutes(day))).toEqual(['quiet_24h:timer']);
    expect(kindsOf(facts({ revertedAt: minutes(5) }), minutes(day))).toEqual(['reverted:user']);
    expect(followUpWindowClosed(facts(), minutes(day))).toBe(true);
  });

  it('ignores follow-ups after the 24 hour window', () => {
    const late = {
      runId: 'late',
      text: "that's wrong",
      category: null,
      classified: true,
      sameChat: true,
      createdAt: minutes(25 * 60),
    };
    expect(kindsOf(facts({ followUps: [late] }), minutes(26 * 60))).toEqual(['quiet_24h:timer']);
  });
});
