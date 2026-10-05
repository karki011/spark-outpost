import { describe, expect, it } from 'vitest';
import {
  HISTORY_TURNS,
  ALL_FINDINGS_RULE,
  RECHECK_RULE,
  FINDING_KIND_RULE,
  IRREVERSIBLE_RULE,
  INCREMENT_RULE,
  MAKE_CHANGE_RULE,
  SHIP_RULE,
  PUBLISH_LATER_RULE,
  PUBLISH_TURN_HEADING,
  publishTurnPrompt,
  PATCH_LIMIT,
  PLAN_FOLLOW_RULE,
  builderPrompt,
  checkFailureText,
  checkFixFollowUp,
  criticFixFollowUp,
  criticPrompt,
  fixFollowUp,
  makeChangeFollowUp,
  namedFiles,
} from './context.ts';
import { reviewFindings, reviewVerdict } from './review.ts';

const plan = [
  'Move parsing into src/dates.ts',
  'Update src/chat/divider.tsx to use it',
  'Add a test',
];

describe('context assembly', () => {
  it('gives a fresh task Builder the request, recent chat and the checks, in small increments', () => {
    const history = Array.from({ length: HISTORY_TURNS + 2 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn ${index}`,
    }));
    const prompt = builderPrompt({
      request: 'Add a CSV export',
      history,
      note: null,
      findings: [],
      checkCommands: ['pnpm test'],
      buildStyle: 'off',
    });
    expect(prompt.startsWith('Role: Builder.')).toBe(true);
    expect(prompt).toContain(INCREMENT_RULE);
    expect(prompt).toContain(SHIP_RULE);
    expect(SHIP_RULE).toMatch(/Don't commit, push, open a pull request, run `gh`/);
    expect(prompt).toContain('## Request\nAdd a CSV export');
    expect(prompt).not.toContain('turn 0');
    expect(prompt).toContain(`turn ${HISTORY_TURNS + 1}`);
    expect(prompt).toContain('## Checks the harness runs after you\n- `pnpm test`');
    expect(prompt).not.toContain('Architect');
  });

  it('tells the Builder to leave publishing to the separate publish turn', () => {
    const base = { request: 'Add a CSV export', history: [], note: null, findings: [] };
    for (const basis of ['requested', 'full_auto', 'follow_up'] as const) {
      const asked = builderPrompt({ ...base, publish: { basis, branch: 'spark/csv-1a' } });
      expect(asked).not.toContain(SHIP_RULE);
      expect(asked).toContain(PUBLISH_LATER_RULE);
      expect(asked).not.toContain('gh pr create');
    }
    const allowed = builderPrompt({ ...base, publish: { basis: 'mode', branch: 'spark/csv-1a' } });
    expect(allowed).toContain('Leave the change in the working tree unless the user asks');
    expect(allowed).toContain('`git push origin spark/csv-1a`');
    expect(allowed).toContain('`spark_push`');
    expect(builderPrompt({ ...base, publish: null })).toContain(SHIP_RULE);
  });

  it('asks for exactly one pull request in the publish turn, with the notes Spark adds', () => {
    const prompt = publishTurnPrompt({
      branch: 'spark/csv-1a',
      draft: true,
      titlePrefix: '[Checks failing]',
      notes: ['Checks failing', 'Jev could not verify this change'],
    });
    expect(prompt.startsWith(PUBLISH_TURN_HEADING)).toBe(true);
    expect(prompt).toContain('`spark_push`');
    expect(prompt).toContain('`git push origin spark/csv-1a`');
    expect(prompt).toContain('`gh pr create`');
    expect(prompt).toContain('`spark_pull_request`');
    expect(prompt).toContain('Open exactly one pull request');
    expect(prompt).toContain('as a draft');
    expect(prompt).toContain('Start the pull request title with "[Checks failing]"');
    expect(prompt).toContain('- Jev could not verify this change');
    expect(prompt).toMatch(/Never force-push, push any other branch or the base branch/);
    expect(prompt).toMatch(/no `--no-verify`/);
  });

  it('asks a follow-up round only to push the fix to the existing pull request', () => {
    const prompt = publishTurnPrompt({
      branch: 'spark/csv-1a',
      draft: false,
      titlePrefix: null,
      notes: [],
      followUp: true,
    });
    expect(prompt).toContain('`spark_push`');
    expect(prompt).toContain("Don't open another pull request, reply on GitHub or resolve threads");
    expect(prompt).not.toContain('gh pr create');
  });

  it('tells the Builder the user chose to apply the previous answer, and includes it', () => {
    expect(makeChangeFollowUp('Rename sum to add.')).toBe(
      `${MAKE_CHANGE_RULE}\n\n## Answer to apply\nRename sum to add.`,
    );
    expect(makeChangeFollowUp(null)).toBe(MAKE_CHANGE_RULE);
    expect(MAKE_CHANGE_RULE).toMatch(/Don't answer the question again or ask whether to make it/);
  });

  it('leaves out the earlier conversation when there is none, and carries your note', () => {
    const prompt = builderPrompt({ request: 'r', history: [], note: 'Use UTC', findings: [] });
    expect(prompt).not.toContain('## Earlier conversation');
    expect(prompt).toContain('## Note from the user\nUse UTC');
  });

  it('puts the agreed plan after the request for the Builder, and asks the Critic to compare', () => {
    const agreedPlan = '## Agreed plan\nGoal: CSV export';
    const builder = builderPrompt({
      request: 'r',
      history: [],
      note: null,
      findings: [],
      agreedPlan,
    });
    expect(builder).toContain(`## Request\nr\n\n${agreedPlan}`);
    const critic = criticPrompt({
      request: 'r',
      plan,
      changes: [],
      patch: '',
      checks: [],
      agreedPlan,
    });
    expect(critic).toContain(PLAN_FOLLOW_RULE);
    expect(critic).toContain(`## Request\nr\n\n${agreedPlan}\n\n## Plan`);
    expect(criticPrompt({ request: 'r', plan, changes: [], patch: '', checks: [] })).not.toContain(
      PLAN_FOLLOW_RULE,
    );
  });

  it('turns a fix request into a short follow-up for the resumed session', () => {
    expect(fixFollowUp('Use UTC')).toContain('Use UTC');
    expect(fixFollowUp(null)).toContain('fix what is wrong');
  });

  it('gives the Critic the request, plan, diff and check results, with the diff capped', () => {
    const prompt = criticPrompt({
      request: 'r',
      plan,
      changes: [{ path: 'a.ts', additions: 1, deletions: 0 }],
      patch: 'x'.repeat(PATCH_LIMIT + 10),
      checks: [],
    });
    expect(prompt).toContain('Verdict: looks good" or "Verdict: concerns"');
    expect(prompt).toContain(`[cut at ${PATCH_LIMIT} characters]`);
    expect(prompt).toContain('## Check results\nNo checks ran.');
    expect(prompt.length).toBeLessThan(PATCH_LIMIT + 2_200);
  });

  it('tells the Critic which changes were already there before the task', () => {
    const prompt = criticPrompt({
      request: 'r',
      plan: [],
      changes: [
        { path: 'src/money.ts', additions: 4, deletions: 1, origin: 'both' },
        { path: 'src/notes.ts', additions: 2, deletions: 0, origin: 'before' },
        { path: 'test/money.test.ts', additions: 9, deletions: 0, origin: 'task' },
      ],
      patch: 'diff',
      checks: [],
    });
    expect(prompt).toContain('- src/money.ts (+4 -1, changed before and during this task)');
    expect(prompt).toContain('- src/notes.ts (+2 -0, changed before this task)');
    expect(prompt).toContain('- test/money.test.ts (+9 -0)\n');
  });

  it('turns failing checks into a short fix request with the end of each output', () => {
    const failures = checkFailureText([
      { command: 'npm test', outcome: 'failed', exitCode: 1, outputTail: `${'x'.repeat(5000)}END` },
      { command: 'npm run lint', outcome: 'timed_out', exitCode: null, outputTail: '' },
    ]);
    expect(failures).toContain('`npm test` exited 1:');
    expect(failures).toContain('END');
    expect(failures).toContain('`npm run lint` timed out:\n```text\n(no output)\n```');
    expect(failures.length).toBeLessThan(3_200);
    const followUp = checkFixFollowUp(failures);
    expect(followUp.startsWith("The project's checks failed")).toBe(true);
    expect(followUp).toContain('## Failing checks\n`npm test` exited 1:');
  });

  it('finds the files a plan names', () => {
    expect(namedFiles(['Edit `src/a.ts` and README.md', 'no files here'])).toEqual([
      'src/a.ts',
      'README.md',
    ]);
    expect(namedFiles(['Move it into src/b.ts. Then update src/c.ts.'])).toEqual([
      'src/b.ts',
      'src/c.ts',
    ]);
  });
});

describe('review parsing', () => {
  it('reads the last verdict line and the findings', () => {
    const text = 'Looks mostly fine.\nFindings:\n- Missing test\n- Typo in name\nVerdict: concerns';
    expect(reviewVerdict(text)).toBe('concerns');
    expect(reviewFindings(text)).toEqual(['Missing test', 'Typo in name']);
    expect(reviewVerdict('**Verdict:** looks good')).toBe('looks_good');
    expect(reviewVerdict('I think it is fine')).toBe('unclear');
  });
});

describe('the Critic finding schema (B3)', () => {
  it('asks the Critic to tag each finding and keep concerns for bugs and missing behaviour', () => {
    const prompt = criticPrompt({ request: 'r', plan: [], changes: [], patch: '', checks: [] });
    expect(prompt).toContain(FINDING_KIND_RULE);
    expect(FINDING_KIND_RULE).toMatch(/\[bug\].*\[missing\].*\[hardening\].*\[style\]/s);
    expect(FINDING_KIND_RULE).toMatch(/"Verdict: concerns" only for \[bug\] or \[missing\]/);
  });

  it('asks the Critic for every finding in one review, edge cases across each changed file (C2)', () => {
    const prompt = criticPrompt({ request: 'r', plan: [], changes: [], patch: '', checks: [] });
    expect(prompt).toContain(ALL_FINDINGS_RULE);
    expect(ALL_FINDINGS_RULE).toMatch(/every concrete finding.*each changed file.*edge cases/s);
    expect(ALL_FINDINGS_RULE).toMatch(/zero, negative, NaN.*"\[hardening\]"/s);
    expect(criticFixFollowUp(['a', 'b'])).toContain('Fix all of them together in this turn');
  });

  it('turns a review after a fix into a recheck of the earlier findings and the fix diff (C)', () => {
    const prompt = criticPrompt({
      request: 'r',
      plan: [],
      changes: [{ path: 'src/rate-limit.ts', additions: 9, deletions: 1 }],
      patch: 'diff --git a/src/whole.ts b/src/whole.ts',
      fixPatch: 'diff --git a/src/rate-limit.ts b/src/rate-limit.ts',
      checks: [],
      previousFindings: ['[bug] `\\r` is left unquoted'],
      earlierNotes: ['[hardening] `windowMs: 0` resets every call'],
    });
    expect(prompt).toContain(RECHECK_RULE);
    expect(prompt).not.toContain(ALL_FINDINGS_RULE);
    expect(prompt).toContain('## Findings the Builder was asked to fix');
    expect(prompt).toContain(
      '## Notes from earlier reviews (not bugs; do not raise again)\n- [hardening] `windowMs: 0` resets every call',
    );
    expect(prompt).toContain('## Fix diff\n```diff\ndiff --git a/src/rate-limit.ts');
    expect(prompt).not.toContain('src/whole.ts');
    expect(prompt).not.toContain('## Complexity');
  });

  it('asks the Critic to flag irreversible data or schema changes the user did not ask for (E)', () => {
    const prompt = criticPrompt({ request: 'r', plan: [], changes: [], patch: '', checks: [] });
    expect(prompt).toContain(IRREVERSIBLE_RULE);
    expect(IRREVERSIBLE_RULE).toMatch(/\[bug\].*DELETE, DROP or TRUNCATE.*destructive migrations/s);
  });
});
