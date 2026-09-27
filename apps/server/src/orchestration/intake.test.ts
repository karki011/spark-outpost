import { describe, expect, it } from 'vitest';
import type { JevIntake } from '@spark-outpost/contracts';
import { decideIntake, type IntakeFacts } from './intake.ts';

const jev = (extra: Partial<JevIntake> = {}): JevIntake => ({
  intent: 'feature',
  complexity: null,
  risk: 'edits',
  injection: null,
  depth: 'execute',
  provider: 'claude',
  model: null,
  modelLabel: null,
  effort: null,
  confidence: 0.9,
  routeConfidence: null,
  confidences: {},
  ...extra,
});

const facts = (extra: Partial<IntakeFacts> = {}): IntakeFacts => ({
  request: 'Add a CSV export to the reports page',
  mode: 'do',
  level: 'balanced',
  firstMessage: false,
  namedFiles: 0,
  currentTask: null,
  ...extra,
});

describe('intake decisions', () => {
  it('answers Ask and Chat turns directly and asks nothing', () => {
    expect(decideIntake(jev(), facts({ mode: 'ask' }))).toMatchObject({
      start: 'answer',
      risk: 'read-only',
      calls: {},
    });
  });

  it('answers a Do question when Jev is sure, and builds when it is sure it is not', () => {
    expect(decideIntake(jev({ question: 0.95 }), facts()).start).toBe('answer');
    expect(decideIntake(jev({ question: 0.05 }), facts()).start).toBe('build');
  });

  it('asks answer-or-build when unsure at Balanced, and uses the rule at Hands-off', () => {
    expect(decideIntake(jev({ question: 0.6 }), facts()).start).toBe('choose');
    expect(decideIntake(jev({ question: 0.6 }), facts({ level: 'hands-off' })).start).toBe('build');
  });

  it('is destructive when either Jev or the keywords say so, never less', () => {
    const drop = facts({ request: 'Drop the legacy users table' });
    expect(decideIntake(jev({ destructive: 0.02 }), drop)).toMatchObject({
      destructive: true,
      risk: 'destructive',
    });
    expect(decideIntake(jev({ destructive: 0.95 }), facts()).destructive).toBe(true);
    expect(decideIntake(jev({ destructive: 0.6 }), facts()).destructive).toBe(false);
    expect(decideIntake(null, drop).destructive).toBe(true);
  });

  it('wants a Critic for a review request from Jev or the phrase rule', () => {
    expect(decideIntake(jev({ review: 0.9 }), facts()).review).toBe(true);
    expect(decideIntake(null, facts({ request: 'Review my changes to the parser' })).review).toBe(
      true,
    );
  });

  it('only judges vagueness on the first message, then asks or assumes by level', () => {
    const vague = facts({ request: 'Make the reports better', firstMessage: true });
    expect(decideIntake(jev({ vague: 0.95 }), vague).start).toBe('interpret');
    expect(decideIntake(jev({ vague: 0.95 }), { ...vague, level: 'full-auto' })).toMatchObject({
      start: 'build',
      assume: true,
    });
    expect(decideIntake(jev({ vague: 0.95 }), { ...vague, firstMessage: false }).start).toBe(
      'build',
    );
  });

  it('decides follow-up or new task from Jev, else from the rule', () => {
    const task = {
      taskId: 't',
      previousRequest: 'Add a CSV export',
      summary: 'Added it.',
      lastReplyAt: new Date('2026-09-27T09:00:00Z'),
    };
    const later = { currentTask: task, now: new Date('2026-09-27T10:00:00Z') };
    expect(decideIntake(jev({ continuesTask: 0.9 }), facts(later)).continues).toBe(true);
    expect(decideIntake(jev({ continuesTask: 0.1 }), facts(later)).continues).toBe(false);
    expect(
      decideIntake(jev({ continuesTask: 0.5 }), facts({ ...later, request: 'also handle it' }))
        .continues,
    ).toBe(true);
    expect(decideIntake(null, facts(later)).continues).toBe(false);
    expect(decideIntake(null, facts()).continues).toBeNull();
  });

  it('records each call with its source for the audit', () => {
    const decided = decideIntake(jev({ question: 0.05, destructive: 0.1, review: 0.5 }), facts());
    expect(decided.calls.question).toMatchObject({ jev: 0.05, value: false, source: 'jev' });
    expect(decided.calls.review).toMatchObject({ jev: 0.5, value: false, source: 'rules' });
  });
});
