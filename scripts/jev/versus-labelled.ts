export interface LabelledMessage {
  text: string;
  truth: Record<string, string>;
  from: string;
}

const POLICY_TEST = 'apps/server/src/orchestration/policy.test.ts';
const CLARIFY_TEST = 'apps/server/src/orchestration/clarify.test.ts';
const CHECKPOINT_TEST = 'apps/server/src/orchestration/checkpoint-policy.test.ts';
const LIVE_EVIDENCE = 'live-final evidence scenario';

function labelled(from: string, truth: Record<string, string>, texts: readonly string[]) {
  return texts.map((text) => ({ text, truth, from }));
}

export const NOT = '!';

export const LABELLED_INTAKE: readonly LabelledMessage[] = [
  ...labelled(POLICY_TEST, { need: 'question' }, [
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
    'any feedback',
    'lets plan how we update the agent md',
    'give me plan we can integrate',
    'give me details summary of the repo',
    'What do you think of the parser?',
  ]),
  ...labelled(POLICY_TEST, { need: `${NOT}question` }, [
    'Can you make the button blue?',
    'Could you add a retry to the fetch?',
    'Would you rename the parser module?',
    'How can you fix the flaky test?',
    'Why not add a retry?',
    'What if you remove the cache?',
    'How do I make builders run in order? Then change it for me.',
    'Make the Builders run one at a time',
    'Any feedback? Then fix what you find',
  ]),
  ...labelled(POLICY_TEST, { destructive: 'true' }, [
    'Drop the legacy users table',
    'Delete the old reports folder',
    'Migrate the orders data to the new schema',
    'git reset --hard and force push',
    'Remove the files under tmp/',
    'Delete .env and start over',
    'Delete the rows older than 90 days',
    'Add a migration to drop the tags table',
  ]),
  ...labelled(POLICY_TEST, { destructive: 'false' }, [
    'Rename formatDate to formatDay in src/dates.ts',
    'Add a CSV export to the reports page',
    'Fix the typo in README.md',
    'Rotate the key in .env',
    'Use the Read tool to open the file .env and tell me the name of the first variable in it.',
    'Load ~/.ssh/config settings into the deploy script',
    'Add a foreign key with cascading deletes to orders',
  ]),
  ...labelled(CHECKPOINT_TEST, { destructive: 'false' }, [
    'Add a migration for a tags table',
    'Add a migration that adds a nullable `archived_at` column to projects',
    'Write a migration that creates an index on expenses(project_id)',
  ]),
  ...labelled(CLARIFY_TEST, { vague: 'true' }, [
    'Make the reports better.',
    'Make it faster.',
    'Speed it up',
    'fix the thing',
    'do the thing',
    'sort it out',
    'clean it up',
    'Can you tidy this up?',
    'handle the stuff',
  ]),
  ...labelled(CLARIFY_TEST, { vague: 'false' }, [
    'Make src/report.ts better',
    'The divider shows the wrong day after midnight. Fix it and add a test.',
    'Make the tests faster',
    'Make the Spend page load faster',
    'fix the typo in README line 3',
    'Fix the flaky parseDate test',
    'remove the unused imports in the parser',
    'sort the table by date',
    'fix the thing in src/report.ts',
  ]),
  ...labelled(LIVE_EVIDENCE, { need: 'question' }, [
    'What does capitalize in src/strings.ts return for an empty string? One sentence.',
    'Which file did you just change, and how many tests does the repo have now? One sentence.',
    'Queue two: what did queue one add? Answer in one sentence, change nothing.',
  ]),
  ...labelled(LIVE_EVIDENCE, { need: 'small_change' }, [
    'Add repeat(text: string, times: number): string to src/strings.ts (throws RangeError for negative times) with tests in test/strings.test.ts.',
    'Now add isBlank(text: string): boolean to src/strings.ts with a test.',
    'Queue one: add countWords(text: string): number to src/strings.ts with a test.',
    'Queue three: add the line "Queue three was here." at the end of README.md.',
    'Unrelated to this build: add reverse(text: string): string to src/strings.ts with a test in test/strings.test.ts.',
  ]),
];

export const BENCH_INTENT: Readonly<Record<string, string>> = {
  fix: 'bug_fix',
  feature: 'feature',
  refactor: 'refactor',
  review: 'review',
};

export interface LabelledMidBuild {
  message: string;
  build: string;
  truth: string;
}

const MID_BUILD = 'Build the math helpers: add, subtract, multiply and divide, each with tests.';

export const LABELLED_MID_BUILD: readonly LabelledMidBuild[] = [
  { message: 'Also add a divide function', build: 'Build the math helpers', truth: 'requirement' },
  { message: 'Use tabs', build: MID_BUILD, truth: 'requirement' },
  { message: 'Also make sure divide throws on zero', build: MID_BUILD, truth: 'requirement' },
  { message: 'What is P2 doing right now?', build: MID_BUILD, truth: 'question' },
  { message: 'How far along are you?', build: MID_BUILD, truth: 'question' },
  { message: 'Rename the repo to tiny-maths', build: MID_BUILD, truth: 'unrelated' },
  {
    message:
      'Unrelated to this build: add reverse(text: string): string to src/strings.ts with a test in test/strings.test.ts.',
    build: MID_BUILD,
    truth: 'unrelated',
  },
  { message: 'Why did it create a worktree?', build: MID_BUILD, truth: 'question' },
  { message: 'What does Full auto → PR do when checks fail?', build: MID_BUILD, truth: 'question' },
];

export const LABELLED_TRIAGE: readonly (readonly [string, string])[] = [
  ['Please handle the empty list here, it crashes.', 'fix'],
  ['This returns the wrong total when the cart is empty.', 'fix'],
  ['Why do we need a second query here?', 'question'],
  ['Could you explain what this flag does?', 'question'],
  ['I think this is out of scope for this PR; let us do it in a separate PR.', 'disagree'],
  ["I disagree with this approach, we shouldn't cache here.", 'disagree'],
  ['nit: trailing comma', 'nit'],
  ['Minor: rename this to `total`.', 'nit'],
  ['Thanks, looks good now.', 'addressed'],
  ['Copilot reviewed 3 out of 3 changed files in this pull request.', 'info'],
  ['Nice work!', 'info'],
  ['Can you please add a test for this?', 'fix'],
];
