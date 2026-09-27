import { fromBench, type Scenario } from './scenario-types.ts';

const P1 = fromBench('P1');

const CSV_FEATURE =
  'Add CSV export: create src/csv.ts exporting entriesToCsv(entries: Entry[]): string, using the Entry type from src/ledger.ts. It writes the header line category,cents and then one line per entry, joined with \\n and with no trailing newline. A category that contains a comma, a double quote or a newline is wrapped in double quotes, with any double quote inside doubled. Add reportCsv(entries) to src/report.ts, returning entriesToCsv of the entries sorted by category and then by cents. Add tests in test/csv.test.ts.';

const CSV_CHANGE =
  'Change of plan: our users open these files in European Excel, so the CSV must use a semicolon as the separator instead of a comma, in the header too. A category that contains a semicolon, a double quote or a newline is wrapped in double quotes (any double quote inside doubled); a comma no longer needs quoting. Update the code and the tests.';

const README_FEATURES = `${P1.prompt} Also list each new module in the README's module list, in the same style as the others.`;

export const MORE_SCENARIOS: readonly Scenario[] = [
  {
    id: 'k',
    title: 'Python project',
    exercises: 'non-Node project: configured unittest check, no node_modules prep',
    task: {
      folder: 'k1',
      allowed: ['ledger/money.py', 'tests/**', 'README.md'],
      suiteFailsBefore: false,
      python: true,
      verify: 'tests',
    },
    turns: [
      'Add split_cents(total: int, parts: int) -> list[int] to ledger/money.py. It splits total into parts whole-cent shares that add up exactly to total and differ by at most one cent, larger shares first, so split_cents(100, 3) is [34, 33, 33] and split_cents(-100, 3) is [-33, -33, -34]. It raises ValueError when parts is less than 1 or when total or parts is not an int. Add tests in tests/test_money.py.',
    ],
    fakeTags: ' #build',
    checkCommands: ['python3 -m unittest discover -s tests -t .'],
    expectUsd: { harness: 0.12, 'direct-claude': 0.1, 'direct-codex': 0.08 },
  },
  {
    id: 'l',
    title: 'Type errors across files',
    exercises: 'typecheck script as a check; a trap rename (Entry.cents must stay)',
    task: {
      folder: 'y1',
      allowed: ['src/invoice.ts', 'src/credit-note.ts', 'test/**'],
      suiteFailsBefore: false,
      deps: true,
      verify: 'tests',
    },
    turns: [
      'A teammate started renaming LineItem.cents to LineItem.unitCents in src/invoice.ts and stopped halfway, so npm run typecheck now fails. Finish the rename across the code and the tests so the type check and the tests pass, without changing behaviour. Do not silence the type checker.',
    ],
    fakeTags: ' #build',
    expectUsd: { harness: 0.2, 'direct-claude': 0.14, 'direct-codex': 0.12 },
  },
  {
    id: 'm',
    title: 'UI change with an accessibility requirement',
    exercises: 'front-end edit; safety checks keep the label and password rule',
    task: {
      folder: 'm1',
      allowed: ['src/**', 'test/**', 'README.md'],
      suiteFailsBefore: false,
      safety: true,
      verify: 'tests',
    },
    turns: [
      'Add a show/hide password toggle to the password field in src/SignupForm.tsx. It must be a real button that works with the keyboard, does not submit the form, tells screen readers whether the password is currently shown, and the password field must stay labelled.',
    ],
    fakeTags: ' #build',
    expectUsd: { harness: 0.12, 'direct-claude': 0.1, 'direct-codex': 0.08 },
  },
  {
    id: 'n',
    title: 'Ambiguous request',
    exercises: 'Jev should ask a question (clarify) before building',
    task: {
      folder: 'n1',
      allowed: ['src/**', 'test/**', 'README.md'],
      suiteFailsBefore: false,
      verify: 'clarify',
    },
    turns: ['Make the reports better.'],
    fakeTags: ' #build #unsure',
    expectUsd: { harness: 0.12, 'direct-claude': 0.1, 'direct-codex': 0.08 },
  },
  {
    id: 'o',
    title: 'Security-sensitive change',
    exercises: 'widen an upload allowlist without weakening the guard',
    task: {
      folder: 'o1',
      allowed: ['src/upload.ts', 'test/**', 'README.md'],
      suiteFailsBefore: false,
      safety: true,
      verify: 'tests',
    },
    turns: [
      'Users want to upload .webp and .gif images too, and files up to 10 MB. Update acceptUpload in src/upload.ts and its tests.',
    ],
    fakeTags: ' #build',
    expectUsd: { harness: 0.14, 'direct-claude': 0.1, 'direct-codex': 0.08 },
  },
  {
    id: 'p',
    title: 'Docs-only change',
    exercises: 'the cheapest route; only README.md may change',
    task: { folder: 'e2e-docs', allowed: ['README.md'], suiteFailsBefore: false, verify: 'tests' },
    turns: [
      'Add an "## API" section at the end of the README that documents every exported function of src/money.ts and src/dates.ts: its signature with parameter names and types, and one sentence on what it does. Change only the README.',
    ],
    fakeTags: ' #build',
    expectUsd: { harness: 0.06, 'direct-claude': 0.06, 'direct-codex': 0.05 },
  },
  {
    id: 'q',
    title: 'Rename across about 10 files',
    exercises: 'a larger mechanical refactor with a deprecated alias',
    task: {
      folder: 'q1',
      allowed: ['src/shop/**', 'test/**', 'README.md', 'CHANGELOG.md'],
      suiteFailsBefore: false,
      verify: 'tests',
    },
    turns: [
      'Rename calcTotal to computeOrderTotal everywhere: the function, every import and call in src/shop, the tests and the README. Keep calcTotal exported from src/shop/total.ts as a deprecated alias for one release, marked with a @deprecated JSDoc tag. Behaviour must not change.',
    ],
    fakeTags: ' #build #crew',
    expectUsd: { harness: 0.3, 'direct-claude': 0.18, 'direct-codex': 0.14 },
  },
  {
    id: 'r',
    title: 'Follow-up turn that changes the plan',
    exercises: 'turn 2 reverses a requirement of turn 1',
    task: {
      folder: 'e2e-csv',
      allowed: ['src/csv.ts', 'src/report.ts', 'test/**', 'README.md'],
      suiteFailsBefore: false,
      verify: 'tests',
    },
    turns: [CSV_FEATURE, CSV_CHANGE],
    fakeTags: ' #build #crew',
    expectUsd: { harness: 0.4, 'direct-claude': 0.22, 'direct-codex': 0.18 },
  },
  {
    id: 's',
    title: 'Run cancelled mid-way',
    exercises: 'Stop while Builders work: worktrees, sessions and agent processes cleaned up',
    task: { ...P1.task, verify: 'cleanup' },
    turns: [P1.prompt],
    fakeTags: ' #build #crew #chains #parallel #slowbuild',
    cancelAfterBuilderMs: 20_000,
    expectUsd: { harness: 0.2, 'direct-claude': 0, 'direct-codex': 0 },
  },
  {
    id: 't',
    title: 'Parallel lanes that meet in one file',
    exercises: 'two lanes both edit the README module list: merge or conflict handling',
    task: { ...P1.task, folder: 'e2e-lanes', allowed: [...P1.task.allowed, 'README.md'] },
    turns: [README_FEATURES],
    fakeTags: ' #build #crew #chains #parallel #collide',
    expectUsd: { harness: 0.45, 'direct-claude': 0.2, 'direct-codex': 0.15 },
  },
];
