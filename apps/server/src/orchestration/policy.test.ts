import { describe, expect, it } from 'vitest';
import { activeTime } from './active-time.ts';
import { asksToKeep, shipsByItself } from './checkpoint-policy.ts';
import {
  asksForReview,
  buildsByRule,
  additiveMigrationWording,
  destructiveByRule,
  destructiveMigrationWording,
  destructiveTargets,
  strongRemovalByRule,
  followUpByRule,
  isLargeDiff,
  planOnlyByRule,
  questionByRule,
  looksAtPageByRule,
  runsCommandsByRule,
  reviewsExistingByRule,
  trivialByRule,
} from './risk-rules.ts';
import { oneTierUp, strongerEffort, tierLadder, topTier } from './tiers.ts';

describe('risk rules', () => {
  it('calls deletions, drops, data migrations and history rewrites destructive', () => {
    for (const request of [
      'Drop the legacy users table',
      'Delete the old reports folder',
      'Migrate the orders data to the new schema',
      'git reset --hard and force push',
      'Remove the files under tmp/',
      'Delete .env and start over',
    ]) {
      expect(destructiveByRule(request), request).toBe(true);
    }
    for (const request of [
      'Rename formatDate to formatDay in src/dates.ts',
      'Add a CSV export to the reports page',
      'Fix the typo in README.md',
      'Rotate the key in .env',
      'Use the Read tool to open the file .env and tell me the name of the first variable in it.',
      'Load ~/.ssh/config settings into the deploy script',
    ]) {
      expect(destructiveByRule(request), request).toBe(false);
    }
  });

  it('points destructive wording at the files named in the same line', () => {
    const request = [
      'Split this up into pieces:',
      '- Add a migration `migrations/002_tags.sql` to drop the `legacy_tags` table.',
      '- Add `src/slug.ts` exporting `slugify`. Add tests in `test/slug.test.ts`.',
    ].join('\n');
    expect(destructiveTargets(request)).toEqual(['migrations/002_tags.sql']);
    expect(destructiveTargets('Delete src/old.ts. Then add src/new.ts.')).toEqual(['src/old.ts']);
    expect(destructiveTargets('Add src/new.ts')).toEqual([]);
  });

  it('reads ON DELETE CASCADE in a foreign key as additive, not destructive (D)', () => {
    const request =
      'Add a migration `migrations/002_upload_tags.sql` that creates an `upload_tags` table (`upload_key` TEXT referencing `uploads(key)` ON DELETE CASCADE, `tag` TEXT NOT NULL).';
    expect(destructiveByRule(request)).toBe(false);
    expect(destructiveMigrationWording(request)).toBe(false);
    expect(additiveMigrationWording(request)).toBe(true);
    expect(destructiveTargets(request)).toEqual([]);
    expect(destructiveByRule('Add a foreign key with cascading deletes to orders')).toBe(false);
    expect(destructiveByRule('Delete the rows older than 90 days')).toBe(true);
    expect(destructiveByRule('Add a migration to drop the tags table')).toBe(true);
  });

  it('counts only strong wording as evidence of data removal', () => {
    expect(strongRemovalByRule('DELETE FROM uploads WHERE size = 0')).toBe(true);
    expect(strongRemovalByRule('Drop table legacy_tags')).toBe(true);
    expect(strongRemovalByRule('Delete the old upload rows')).toBe(true);
    expect(strongRemovalByRule('Truncate the audit log')).toBe(true);
    expect(strongRemovalByRule('Rename the runs table column and migrate old rows')).toBe(true);
    expect(strongRemovalByRule('Add a delete button to the upload list')).toBe(false);
    expect(strongRemovalByRule('Handle the delete event in the queue')).toBe(false);
    expect(strongRemovalByRule('Create tags with ON DELETE CASCADE')).toBe(false);
  });

  it('calls short, local wording and formatting fixes trivial', () => {
    expect(trivialByRule('Fix the typo in README.md')).toBe(true);
    expect(trivialByRule('Rename formatDate to formatDay in src/dates.ts')).toBe(true);
    expect(trivialByRule('Rename formatDate in src/a.ts and src/b.ts')).toBe(false);
    expect(trivialByRule('Add a CSV export to the reports page')).toBe(false);
    expect(trivialByRule('Delete the typo file')).toBe(false);
  });

  it('keeps a Critic for a review of existing changes or of the requested work', () => {
    expect(asksForReview('Review my changes to the parser')).toBe(true);
    expect(asksForReview('Can you look over the diff?')).toBe(true);
    expect(asksForReview('Review and fix the parser')).toBe(true);
    expect(asksForReview('Add a retry. When it is built, have a reviewer check the change.')).toBe(
      true,
    );
    expect(asksForReview('Address the review comments on the parser')).toBe(false);
    expect(asksForReview('Add a retry to the upload')).toBe(false);
  });

  it('reads a leading review of existing changes, with nothing to change, as review-only', () => {
    for (const request of [
      "Review my uncommitted changes before I commit them. Don't change anything; just tell me what's wrong.",
      'Can you look over my staged changes?',
      'Check the diff on this branch for bugs',
      'Please review the current changes',
    ]) {
      expect(reviewsExistingByRule(request), request).toBe(true);
    }
    for (const request of [
      'Review my changes to the parser and fix what you find',
      'Review my uncommitted changes, then fix the bugs',
      'Add a retry. When it is built, have a reviewer check the change.',
      'Add a retry, then review the changes',
      'Review and fix the parser',
      'Check that the tests pass',
    ]) {
      expect(reviewsExistingByRule(request), request).toBe(false);
    }
  });

  it('reads explicit plan-only wording as a plan request, never a brainstorm or a plan-then-build', () => {
    for (const request of [
      "Plan adding CSV export to Analytics. Plan only for now: don't change any files.",
      'Plan adding CSV export to Analytics',
      'Just a plan for now: how would we split the reports module?',
      'Write up a plan for moving auth to JWT',
      'Can you draft a plan for the tags feature?',
    ]) {
      expect(planOnlyByRule(request), request).toBe(true);
    }
    for (const request of [
      'Brainstorm a few ways we could show that, with the trade-offs of each. Options only for now: no plan and no changes.',
      'Plan the CSV export and then build it',
      "How does the code scan decide which files to read? Just answer; don't change anything.",
      'Add CSV export to the Spend tab',
      "Fix the typo. Don't change any other files.",
    ]) {
      expect(planOnlyByRule(request), request).toBe(false);
    }
  });

  it('reads a question mark without a build verb as a question', () => {
    expect(questionByRule('How does the retry logic work?')).toBe(true);
    expect(questionByRule('Can you add a retry?')).toBe(false);
    expect(questionByRule('Explain the retry logic')).toBe(false);
  });

  it.each([
    'How do I make Builders run one at a time?',
    'How can I make the Critic skip small changes?',
    'How do you add a project?',
    'What does Full auto → PR do when checks fail?',
    "What's the best way to add a migration?",
    'Why did it create a worktree?',
    'Can Spark make a draft PR by itself?',
    'Can I change where Spark works?',
    'Is there a way to make Builders run in order?',
    'Should we split the parser before we add tests?',
    'Where do I change the spend cap?',
  ])('reads the how-to question "%s" as a question even with a build verb', (request) => {
    expect(questionByRule(request)).toBe(true);
  });

  it.each([
    'Can you make the button blue?',
    'Could you add a retry to the fetch?',
    'Would you rename the parser module?',
    'How can you fix the flaky test?',
    'Why not add a retry?',
    'What if you remove the cache?',
    'How do I make builders run in order? Then change it for me.',
    'Make the Builders run one at a time',
  ])('reads the request "%s" as a change', (request) => {
    expect(questionByRule(request)).toBe(false);
  });

  it('reads plan and feedback requests from the audit as answers, not changes', () => {
    for (const request of [
      'any feedback',
      'lets plan how we update the agent md',
      'give me plan we can integrate',
      'give me details summary of the repo',
      'What do you think of the parser?',
    ]) {
      expect(questionByRule(request), request).toBe(true);
    }
    expect(questionByRule('Any feedback? Then fix what you find')).toBe(false);
  });

  it('reads a request to run named commands or fetch a URL as an answer', () => {
    for (const request of [
      'Run `ls -la` and `curl -sI https://example.com | head -3`',
      'Now please run `git log --oneline -5`',
      'fetch https://example.com/status.json',
    ]) {
      expect(runsCommandsByRule(request), request).toBe(true);
      expect(questionByRule(request), request).toBe(true);
    }
    for (const request of [
      'Run the tests',
      'Run `pnpm test` and fix the failures',
      'Add a `--verbose` flag',
    ]) {
      expect(runsCommandsByRule(request), request).toBe(false);
    }
  });

  it('reads a request to look at a page in the browser as an answer, not build work', () => {
    for (const request of [
      'Start the dev server for this project, open the home page in the browser, tell me the heading text and what the button says, take a screenshot, then open /errors and tell me what the console and network logs show.',
      "The dev server is already running at http://127.0.0.1:47733 (I started it). Use Spark's built-in browser: open the home page, tell me the heading, take a screenshot, then open /errors and report the console and network logs.",
      'Inspect localhost on port 5173 and describe the layout',
      'Take a screenshot of the pricing page in the browser and tell me what looks off',
      'Open http://localhost:3000 in the browser and read the page. Do not change or delete any files.',
      'Inspect the page in the browser without making changes, and don’t edit files yet.',
    ]) {
      expect(looksAtPageByRule(request), request).toBe(true);
      expect(questionByRule(request), request).toBe(true);
    }
    for (const request of [
      'Open the settings page in a dialog instead of a new tab',
      'Open localhost:5173 in the browser and fix the header overlap',
      'Check the browser console and then fix what you find',
      'Add a screenshot of the browser to the README',
    ]) {
      expect(questionByRule(request), request).toBe(false);
    }
  });

  it('reads a request that leads with a change verb as a build', () => {
    expect(buildsByRule('Add a CSV export to the reports page')).toBe(true);
    expect(buildsByRule("Let's rename the parser module")).toBe(true);
    expect(buildsByRule('Please fix the flaky test')).toBe(true);
    expect(buildsByRule('lets plan the export')).toBe(false);
    expect(buildsByRule('any feedback')).toBe(false);
    expect(buildsByRule('The export looks slow to me')).toBe(false);
  });

  it('treats short references back, or a quick reply, as a follow-up', () => {
    const now = new Date('2026-09-27T10:00:00Z');
    const old = new Date('2026-09-27T09:00:00Z');
    expect(followUpByRule('also handle empty input', old, now)).toBe(true);
    expect(followUpByRule('now add a logout button to the header', old, now)).toBe(false);
    expect(
      followUpByRule(
        'now add a logout button to the header',
        new Date('2026-09-27T09:55:00Z'),
        now,
      ),
    ).toBe(true);
    expect(followUpByRule('add a logout button', null, now)).toBe(false);
  });

  it('calls a diff large at 400 changed lines or 10 files, not counting lockfiles', () => {
    const file = (path: string, additions: number) => ({ path, additions, deletions: 0 });
    expect(isLargeDiff([file('src/a.ts', 399)])).toBe(false);
    expect(isLargeDiff([file('src/a.ts', 300), file('src/b.ts', 100)])).toBe(true);
    expect(isLargeDiff([file('src/a.ts', 10), file('pnpm-lock.yaml', 5000)])).toBe(false);
    const many = Array.from({ length: 10 }, (_, index) => file(`src/${index}.ts`, 1));
    expect(isLargeDiff(many)).toBe(true);
  });
});

describe('level checkpoints', () => {
  it('keeps settled changes without asking', () => {
    expect(asksToKeep('hands-off', 3)).toBe(false);
    expect(asksToKeep('full-auto', 3)).toBe(false);
  });

  it('ships by itself only at Full auto, and only with changed files', () => {
    expect(shipsByItself('full-auto', 2)).toBe(true);
    expect(shipsByItself('full-auto', 0)).toBe(false);
    expect(shipsByItself('hands-off', 2)).toBe(false);
  });
});

describe('active time', () => {
  it('excludes approval waits', () => {
    expect(activeTime(10_000, 9_500)).toBe(500);
    expect(activeTime(100, 500)).toBe(0);
  });
});

describe('model tiers', () => {
  const claude = [
    { id: 'default', label: 'Default (recommended)' },
    { id: 'opus[1m]', label: 'Opus 5.5' },
    { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' },
    { id: 'sonnet', label: 'Sonnet 5' },
    { id: 'haiku', label: 'Haiku 4.5' },
  ];
  const codex = [
    { id: 'gpt-6-astra', label: '6 Astra' },
    { id: 'gpt-6-sol', label: '6 Sol' },
    { id: 'gpt-6-luna', label: '6 Luna' },
  ];

  it('orders Haiku, Sonnet, Opus and the Codex equivalents, leaving frontier models off', () => {
    expect(tierLadder(claude).map((model) => model.id)).toEqual(['haiku', 'sonnet', 'opus[1m]']);
    expect(tierLadder(codex).map((model) => model.id)).toEqual(['gpt-6-luna', 'gpt-6-sol']);
    expect(topTier(claude)?.id).toBe('opus[1m]');
  });

  it('escalates one tier at a time and stops at the top', () => {
    expect(oneTierUp(claude, 'haiku')?.id).toBe('sonnet');
    expect(oneTierUp(claude, 'sonnet')?.id).toBe('opus[1m]');
    expect(oneTierUp(claude, 'opus[1m]')).toBeNull();
    expect(oneTierUp(claude, 'default')).toBeNull();
  });

  it('raises effort when the model is already at the top, never to max', () => {
    expect(strongerEffort(['low', 'medium', 'high', 'max'], 'medium')).toBe('high');
    expect(strongerEffort(['low', 'medium', 'high', 'max'], 'high')).toBe('high');
  });
});
