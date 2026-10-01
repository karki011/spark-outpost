import { describe, expect, it } from 'vitest';
import {
  HISTORY_TURNS,
  FINDING_KIND_RULE,
  IRREVERSIBLE_RULE,
  INCREMENT_RULE,
  MAKE_CHANGE_RULE,
  SHIP_RULE,
  PATCH_LIMIT,
  PLAN_FOLLOW_RULE,
  builderPrompt,
  checkFailureText,
  checkFixFollowUp,
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
    expect(prompt.length).toBeLessThan(PATCH_LIMIT + 2_000);
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

  it('asks the Critic to flag irreversible data or schema changes the user did not ask for (E)', () => {
    const prompt = criticPrompt({ request: 'r', plan: [], changes: [], patch: '', checks: [] });
    expect(prompt).toContain(IRREVERSIBLE_RULE);
    expect(IRREVERSIBLE_RULE).toMatch(/\[bug\].*DELETE, DROP or TRUNCATE.*destructive migrations/s);
  });
});
