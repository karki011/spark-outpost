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

  it('asks the clarify card at Auto-edit for the rerun\'s "Make it faster." (Jev vague 0.94)', () => {
    const faster = facts({ request: 'Make it faster.', firstMessage: true, level: 'hands-off' });
    const decided = decideIntake(jev({ vague: 0.94, intent: 'refactor' }), faster);
    expect(decided).toMatchObject({ start: 'interpret', assume: false });
    expect(decided.calls.vague).toMatchObject({ jev: 0.94, value: true, source: 'jev' });
    // Without Jev the vague rule decides, and it asks too.
    expect(decideIntake(null, faster)).toMatchObject({ start: 'interpret', assume: false });
    // Jev unsure (0.6) at Auto-edit falls back to the rule, which reads it as vague.
    expect(decideIntake(jev({ vague: 0.6 }), faster).start).toBe('interpret');
    // Only Full auto assumes.
    expect(decideIntake(jev({ vague: 0.94 }), { ...faster, level: 'full-auto' })).toMatchObject({
      start: 'build',
      assume: true,
    });
    // A clear request at Auto-edit is not vague and builds.
    const clear = facts({
      request: 'The divider shows the wrong day after midnight. Fix it and add a test.',
      firstMessage: true,
      level: 'hands-off',
    });
    expect(decideIntake(jev({ vague: 0.05 }), clear).start).toBe('build');
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

const CSV_PLAN = [
  'Plan adding CSV export to Analytics. On the Spend tab, an "Export CSV" button downloads the spend breakdown (one row per project, provider and model).',
  'Put the CSV itself in a pure function `spendCsv(data: AnalyticsSpend): string` in `apps/web/src/analytics/spend-csv.ts`.',
  "Plan only for now: don't change any files. I'll build it in a separate session.",
].join('\n\n');
const BRAINSTORM =
  "I'd like people to see which files the code scan skipped and why. Brainstorm a few ways we could show that, with the trade-offs of each. Options only for now: no plan and no changes.";
const REVIEW_S07 =
  "Review my uncommitted changes before I commit them. Don't change anything; just tell me what's wrong.";
const QUESTION_S01 =
  "How does the code scan decide which files to read and index? Which files does it skip, and where in the code is that decided? Just answer; don't change anything.";

describe('plan-only and review-only requests (dev-day s02, s03, s07)', () => {
  it('plans a plan-only request instead of asking answer-or-build (s03)', () => {
    const unsure = decideIntake(
      jev({ question: 0.69, planOnly: 0.2 }),
      facts({ request: CSV_PLAN }),
    );
    expect(unsure.start).toBe('plan');
    expect(unsure.calls.plan_only).toMatchObject({ rule: true, value: true });
    expect(decideIntake(null, facts({ request: CSV_PLAN })).start).toBe('plan');
    const jevOnly = facts({ request: 'Work out how we would move the settings into Postgres' });
    expect(decideIntake(jev({ question: 0.3, planOnly: 0.95 }), jevOnly).start).toBe('plan');
  });

  it('keeps a brainstorm answer-only, with no plan (s02)', () => {
    const decided = decideIntake(
      jev({ question: 0.95, planOnly: 0.05 }),
      facts({ request: BRAINSTORM }),
    );
    expect(decided.start).toBe('answer');
    expect(decided.calls.plan_only).toBeUndefined();
    expect(decideIntake(null, facts({ request: BRAINSTORM })).start).not.toBe('plan');
  });

  it('sends "review my uncommitted changes" to the Critic, with or without Jev (s07)', () => {
    const request = facts({ request: REVIEW_S07 });
    expect(decideIntake(jev({ question: 0.93, review: 0.9 }), request)).toMatchObject({
      start: 'review',
      review: true,
    });
    expect(decideIntake(jev({ question: 0.05, review: 0.95 }), request).start).toBe('review');
    expect(decideIntake(jev({ question: 0.93, review: 0.1 }), request).start).toBe('review');
    expect(decideIntake(null, request).start).toBe('review');
  });

  it('still builds when a review comes with a change, and answers a plain question (s01)', () => {
    const fixToo = facts({ request: 'Review my changes to the parser and fix what you find' });
    expect(decideIntake(jev({ question: 0.05, review: 0.95 }), fixToo)).toMatchObject({
      start: 'build',
      review: true,
    });
    const question = decideIntake(
      jev({ question: 0.95, review: 0.05 }),
      facts({ request: QUESTION_S01 }),
    );
    expect(question.start).toBe('answer');
  });
});
