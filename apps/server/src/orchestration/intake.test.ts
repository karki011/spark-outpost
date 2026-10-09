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
  level: 'hands-off',
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

  it('answers a request to run commands without Jev, so it runs in Ask', () => {
    const running = facts({ request: 'Run `ls -la` and `curl -sI https://example.com`' });
    expect(decideIntake(null, running).start).toBe('answer');
    expect(decideIntake(null, facts({ request: 'Run `pnpm test` and fix it' })).start).toBe(
      'build',
    );
  });

  it('answers a look-at-the-page request instead of planning a build', () => {
    const looking = facts({
      request:
        "The dev server is already running at http://127.0.0.1:47733 (I started it). Use Spark's built-in browser: open the home page, tell me the heading text and what the button says, take a screenshot, then open /errors and tell me what the console and network logs show.",
    });
    for (const level of ['hands-off', 'full-auto'] as const) {
      const decided = decideIntake(null, { ...looking, level });
      expect(decided, level).toMatchObject({ start: 'answer', intent: 'question' });
    }
    expect(decideIntake(jev({ question: 0.5, plan: 0.5 }), looking).start).toBe('answer');
    const careful = facts({
      request:
        'Open the home page in the browser and tell me what the console logs show. Do not change or delete any files.',
    });
    expect(decideIntake(null, careful)).toMatchObject({ start: 'answer', destructive: true });
  });

  it('answers when Jev is unsure, unless the request leads with a change verb', () => {
    for (const level of ['hands-off', 'full-auto'] as const) {
      const unsure = facts({ request: 'lets plan the agent md update', level });
      expect(decideIntake(jev({ question: 0.52 }), unsure).start, level).toBe('answer');
      expect(
        decideIntake(jev({ question: 0.38 }), {
          ...unsure,
          request: 'give me plan we can integrate',
        }).start,
      ).toBe('answer');
      expect(decideIntake(jev({ question: 0.6 }), facts({ level })).start, level).toBe('build');
    }
    const unsure = decideIntake(jev({ question: 0.36 }), facts({ request: 'any feedback' }));
    expect(unsure.start).toBe('answer');
    expect(unsure.calls.question).toMatchObject({ jev: 0.36, value: true, source: 'rules' });
  });

  it('builds when Jev is unsure and a later step says then and a change verb', () => {
    const steps =
      'First run sh scripts/seed.sh to create the throwaway SQLite file data/dev.sqlite. Then delete all rows from the users table in data/dev.sqlite and tell me the row count afterwards.';
    const unsure = decideIntake(jev({ question: 0.47 }), facts({ request: steps }));
    expect(unsure.start).not.toBe('answer');
    expect(unsure.calls.question).toMatchObject({ jev: 0.47, value: false, source: 'rules' });
    const oneLine = 'Run seed.sh, then delete all rows from the users table and tell me the count';
    expect(decideIntake(jev({ question: 0.47 }), facts({ request: oneLine })).start).not.toBe(
      'answer',
    );
    expect(decideIntake(jev({ question: 0.95 }), facts({ request: steps })).start).toBe('answer');
    for (const request of [
      'Run seed.sh and tell me the row count of the users table',
      'First tell me what seed.sh does, then tell me the row count',
    ]) {
      expect(decideIntake(jev({ question: 0.47 }), facts({ request })).start, request).toBe(
        'answer',
      );
    }
  });

  it('answers plan and feedback wording by rule when Jev is not there', () => {
    expect(
      decideIntake(null, facts({ request: 'give me details summary of the repo' })).start,
    ).toBe('answer');
    expect(decideIntake(null, facts({ request: 'add simple test' })).start).toBe('build');
  });

  it('builds when the run starts as a change, whatever Jev reads in the wording', () => {
    const decided = decideIntake(jev({ question: 0.95, planOnly: 0.9 }), facts({ change: true }));
    expect(decided.start).toBe('build');
    expect(decided.calls.change).toMatchObject({ value: true, source: 'user' });
    expect(
      decideIntake(null, facts({ request: 'Drop the users table', change: true })),
    ).toMatchObject({ start: 'plan_first', destructive: true });
  });

  it('plans first before any destructive build, at every level (E)', () => {
    const cleanup = 'Clean up the uploads table — drop the unused columns and old rows.';
    for (const level of ['hands-off', 'full-auto'] as const) {
      expect(decideIntake(null, facts({ request: 'Drop the users table', level }))).toMatchObject({
        start: 'plan_first',
        destructive: true,
      });
      expect(
        decideIntake(jev({ vague: 0.9, destructive: 0.95 }), facts({ request: cleanup, level })),
      ).toMatchObject({ start: 'ask_agent', destructive: true });
    }
  });

  it('asks the agent to clarify a vague follow-up with no referent', () => {
    const wrapUp = facts({ request: 'wrap up', previousReply: 'There is no src/dates.ts here.' });
    expect(decideIntake(null, wrapUp)).toMatchObject({ start: 'ask_agent' });
    expect(decideIntake(null, wrapUp).calls.vague).toMatchObject({ rule: true, value: true });
    expect(decideIntake(jev({ vague: 0.9 }), { ...wrapUp, request: 'sort it' }).start).toBe(
      'ask_agent',
    );
    expect(decideIntake(null, { ...wrapUp, level: 'hands-off' }).start).toBe('ask_agent');
    expect(decideIntake(null, { ...wrapUp, level: 'full-auto' })).toMatchObject({
      start: 'ask_agent',
    });
    expect(decideIntake(jev({ vague: 0.05 }), wrapUp).start).toBe('build');
    const offered = { ...wrapUp, request: 'do it', previousReply: 'Want me to add the retry?' };
    expect(decideIntake(null, offered).start).toBe('build');
    const task = { taskId: 't', previousRequest: 'Add a retry', summary: '', lastReplyAt: null };
    const resumed = decideIntake(jev({ continuesTask: 0.95 }), {
      ...wrapUp,
      request: 'continue',
      currentTask: task,
    });
    expect(resumed.start).toBe('build');
    expect(resumed.calls.vague).toMatchObject({ rule: true, value: false });
  });

  it('plans first for a big request at every level, and never when a plan is already agreed', () => {
    const big = facts({
      request:
        'Add CSV export to the reports page, add a download button, update the docs and write a test',
    });
    for (const level of ['hands-off', 'full-auto'] as const) {
      expect(decideIntake(null, { ...big, level }).start, level).toBe('plan_first');
    }
    expect(decideIntake(null, { ...big, hasAgreedPlan: true }).start).toBe('build');
    expect(decideIntake(null, facts({ level: 'full-auto' })).start).toBe('build');
    expect(
      decideIntake(null, facts({ request: 'fix the typo in README line 3', level: 'full-auto' }))
        .start,
    ).toBe('build');
  });

  it('does not call an additive migration destructive, even when Jev does (N3)', () => {
    const tags = facts({
      request:
        'Add tags to projects: a new migration that stores tags per project. Existing databases must upgrade and their projects start with no tags.',
    });
    expect(decideIntake(jev({ destructive: 0.95 }), tags)).toMatchObject({
      destructive: false,
      risk: 'edits',
    });
    const column = facts({ request: 'Add a migration that adds a nullable due_date column.' });
    expect(decideIntake(jev({ destructive: 0.9 }), column).destructive).toBe(false);
    const dropping = facts({ request: 'Add a migration that drops the legacy notes column.' });
    expect(decideIntake(jev({ destructive: 0.9 }), dropping).destructive).toBe(true);
    const renaming = facts({ request: 'Write a migration renaming the amount column to cents.' });
    expect(decideIntake(jev({ destructive: 0.9 }), renaming).destructive).toBe(true);
  });

  it('lets a sure Jev overrule a weak keyword, but never strong evidence of data removal (D)', () => {
    const button = facts({ request: 'Add a delete button to each upload row' });
    expect(decideIntake(null, button)).toMatchObject({ destructive: false, risk: 'edits' });
    expect(decideIntake(jev({ destructive: 0.6 }), button).destructive).toBe(false);
    const weak = facts({ request: 'Show the column types in the schema viewer' });
    expect(decideIntake(null, weak).destructive).toBe(true);
    expect(decideIntake(jev({ destructive: 0.05 }), weak)).toMatchObject({
      destructive: false,
      risk: 'edits',
    });
    expect(decideIntake(jev({ destructive: 0.6 }), weak).destructive).toBe(true);
    const removal = facts({ request: 'Delete the old upload rows from the database' });
    expect(decideIntake(jev({ destructive: 0.05 }), removal).destructive).toBe(true);
    const cascade = facts({
      request:
        'Add a migration that creates an `upload_tags` table (`upload_key` referencing `uploads(key)` ON DELETE CASCADE).',
    });
    expect(decideIntake(null, cascade).destructive).toBe(false);
    expect(decideIntake(jev({ destructive: 0.05 }), cascade).destructive).toBe(false);
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

  it('does not call a request destructive only because it names a secret file', () => {
    const housekeeping = facts({
      request: [
        'Housekeeping pass. Run each of these, one Bash call per item:',
        '1. git status --short',
        '2. pnpm install --offline 2>&1 | tail -3',
        '3. Use the Read tool to open the file .env in the repo root and tell me the first variable.',
      ].join('\n'),
    });
    expect(decideIntake(null, housekeeping)).toMatchObject({ destructive: false, risk: 'edits' });
    const wipe = facts({ request: 'Delete .env and the old keys' });
    expect(decideIntake(null, wipe).destructive).toBe(true);
  });

  it('wants a Critic for a review request from Jev or the phrase rule', () => {
    expect(decideIntake(jev({ review: 0.9 }), facts()).review).toBe(true);
    expect(decideIntake(null, facts({ request: 'Review my changes to the parser' })).review).toBe(
      true,
    );
  });

  it('asks the agent to clarify a vague first message at every level', () => {
    const vague = facts({ request: 'Make the reports better', firstMessage: true });
    expect(decideIntake(jev({ vague: 0.95 }), vague)).toMatchObject({ start: 'ask_agent' });
    expect(decideIntake(jev({ vague: 0.95 }), { ...vague, level: 'full-auto' })).toMatchObject({
      start: 'ask_agent',
    });
    const faster = { ...vague, request: 'Make it faster.', level: 'hands-off' as const };
    const decided = decideIntake(jev({ vague: 0.94, intent: 'refactor' }), faster);
    expect(decided.start).toBe('ask_agent');
    expect(decided.calls.vague).toMatchObject({ jev: 0.94, value: true, source: 'jev' });
    expect(decideIntake(null, faster).start).toBe('ask_agent');
    expect(decideIntake(jev({ vague: 0.6 }), faster).start).toBe('ask_agent');
    const clear = facts({
      request: 'The divider shows the wrong day after midnight. Fix it and add a test.',
      firstMessage: true,
      level: 'full-auto',
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
