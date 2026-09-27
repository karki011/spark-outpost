import { fromBench, type Scenario, type ScenarioTask } from './scenario-types.ts';
import { MORE_SCENARIOS } from './scenarios-more.ts';

export * from './scenario-types.ts';

function single(id: string): { task: ScenarioTask; turns: string[] } {
  const bench = fromBench(id);
  return { task: bench.task, turns: [bench.prompt] };
}

const QA_PROMPT =
  'Just answer, do not change any files. In src/money.ts, what does parseCents return for "$1,234.50", and what happens when it is given "(5.00)"?';

const CHECKS_PROMPT =
  'Add clampCents(cents: number, min: number, max: number): number to src/money.ts. It returns cents limited to the range from min to max, inclusive. It throws an Error when min is greater than max or when cents is not a whole number. Add tests in test/money.test.ts.';

const RESUME_FOLLOW_UP =
  'Now give percentOf an optional third parameter, decimals, for the number of decimal places, defaulting to 1, so percentOf(1, 3, 2) is 33.33 and percentOf(2, 3, 0) is 67. Update the tests.';

const REVIEWED_SUFFIX = ' When it is built, have a reviewer check the change before you finish.';

const H4 = fromBench('H4');
const RESUME_TASK = {
  folder: 'i1',
  allowed: ['src/money.ts', 'test/**', 'README.md'],
  suiteFailsBefore: false,
  verify: 'tests',
} as const;

export const CORE_SCENARIOS: readonly Scenario[] = [
  {
    id: 'a',
    title: 'Simple question',
    exercises: 'Q&A in Do mode: the cheapest crew, no edits',
    task: {
      folder: 'q1',
      allowed: [],
      suiteFailsBefore: false,
      verify: 'answer',
      answer: [/123,?450/, /throw|error|reject|not an amount|invalid/i],
    },
    turns: [QA_PROMPT],
    fakeTags: '',
    expectUsd: { harness: 0.04, 'direct-claude': 0.04, 'direct-codex': 0.03 },
  },
  {
    id: 'b',
    title: 'Single-file fix',
    exercises: 'execute depth, one Builder, edit approvals',
    ...single('T2'),
    fakeTags: ' #build',
    expectUsd: { harness: 0.06, 'direct-claude': 0.06, 'direct-codex': 0.05 },
  },
  {
    id: 'c',
    title: 'Vague multi-module fix',
    exercises: 'plan then execute: Architect, plan approval, Builder',
    ...single('H1'),
    fakeTags: ' #build #crew',
    expectUsd: { harness: 0.38, 'direct-claude': 0.18, 'direct-codex': 0.14 },
  },
  {
    id: 'd',
    title: 'Two independent features',
    exercises: 'parallel lanes: shared tree or worktrees, node_modules prep',
    ...single('P1'),
    fakeTags: ' #build #crew #chains #parallel',
    expectUsd: { harness: 0.4, 'direct-claude': 0.19, 'direct-codex': 0.15 },
  },
  {
    id: 'e',
    title: 'Explicit review request',
    exercises: 'review intent keeps a Critic at execute depth',
    ...single('R1'),
    fakeTags: ' #build',
    expectUsd: { harness: 0.16, 'direct-claude': 0.15, 'direct-codex': 0.12 },
  },
  {
    id: 'f',
    title: 'Destructive clean-up with approval',
    exercises: 'destructive risk: top-tier Architect, plan approval, Critic, Keep',
    ...single('D2'),
    fakeTags: ' #build #crew',
    expectUsd: { harness: 0.35, 'direct-claude': 0.12, 'direct-codex': 0.12 },
  },
  {
    id: 'g',
    title: 'Project check the Builder does not know about',
    exercises: 'M4 checks fail after the Builder, the fix turn resumes the Builder',
    task: {
      folder: 'g1',
      allowed: ['src/money.ts', 'test/**', 'api-surface.json', 'README.md', 'CHANGELOG.md'],
      suiteFailsBefore: false,
      verify: 'tests',
    },
    turns: [CHECKS_PROMPT],
    fakeTags: ' #build',
    expectUsd: { harness: 0.2, 'direct-claude': 0.1, 'direct-codex': 0.1 },
  },
  {
    id: 'h',
    title: 'Over-build-prone cache task',
    exercises: 'Lean off vs lean on a task with a hand-rolled-class trap',
    ...single('L2'),
    fakeTags: ' #build',
    expectUsd: { harness: 0.16, 'direct-claude': 0.12, 'direct-codex': 0.1 },
  },
  {
    id: 'i',
    title: 'Second turn in the same chat',
    exercises: 'M6: turn 2 resumes the session (or starts fresh)',
    task: RESUME_TASK,
    turns: [fromBench('T3').prompt, RESUME_FOLLOW_UP],
    fakeTags: ' #build',
    expectUsd: { harness: 0.14, 'direct-claude': 0.12, 'direct-codex': 0.1 },
  },
  {
    id: 'j',
    title: 'Cross-provider build and review',
    exercises: 'Claude Builder with a Codex Critic, and the reverse',
    task: H4.task,
    turns: [`${H4.prompt}${REVIEWED_SUFFIX}`],
    fakeTags: ' #build #crew',
    expectUsd: { harness: 0.28, 'direct-claude': 0.15, 'direct-codex': 0.12 },
  },
];

export const SCENARIOS: readonly Scenario[] = [...CORE_SCENARIOS, ...MORE_SCENARIOS];

export function scenarioById(id: string): Scenario {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}.`);
  return scenario;
}
