import { LEAN_TASKS } from './tasks-lean.ts';
import { ROUND3_TASKS } from './tasks-round3.ts';

export type BenchTaskId =
  | 'T1'
  | 'T2'
  | 'T3'
  | 'T4'
  | 'T5'
  | 'H1'
  | 'H2'
  | 'H3'
  | 'H4'
  | 'H5'
  | 'D1'
  | 'D2'
  | 'R1'
  | 'P1'
  | 'L1'
  | 'L2';

export type BenchSet = 'standard' | 'hard' | 'lean';

export interface BenchTask {
  id: BenchTaskId;
  set: BenchSet;
  exercises: string;
  folder: string;
  title: string;
  kind: string;
  prompt: string;
  allowed: readonly string[];
  suiteFailsBefore: boolean;
  safety?: boolean;
}

const BASE_TASKS: readonly BenchTask[] = [
  {
    id: 'T1',
    exercises: 'Haiku route for trivial work',
    set: 'standard',
    folder: 't1',
    title: 'Fix two typos',
    kind: 'trivial',
    prompt:
      "Fix the spelling mistake in the greeting message in src/greet.ts and the spelling mistake in the README's opening sentence. Change nothing else.",
    allowed: ['src/greet.ts', 'README.md'],
    suiteFailsBefore: false,
  },
  {
    id: 'T2',
    exercises: 'bug fix; the 0.8 cheaper-pick gate',
    set: 'standard',
    folder: 't2',
    title: 'Date off-by-one',
    kind: 'bug fix',
    prompt:
      'The test in test/dates.test.ts fails because formatIsoDate prints the wrong month. Fix the bug in the source so the test passes. Do not change the tests.',
    allowed: ['src/dates.ts'],
    suiteFailsBefore: true,
  },
  {
    id: 'T3',
    exercises: 'small feature; the 0.8 cheaper-pick gate',
    set: 'standard',
    folder: 't3',
    title: 'Add percentOf',
    kind: 'small feature',
    prompt:
      'Add a function percentOf(part: number, total: number): number to src/money.ts. It returns part as a percentage of total rounded to one decimal place (percentOf(1, 3) is 33.3) and returns 0 when total is 0. Add tests for it in test/money.test.ts.',
    allowed: ['src/money.ts', 'test/**'],
    suiteFailsBefore: false,
  },
  {
    id: 'T4',
    exercises: 'named files skip the Architect',
    set: 'standard',
    folder: 't4',
    title: 'Extract util module',
    kind: 'multi-file refactor',
    prompt:
      'Refactor: move the helper functions roundTo and titleCase out of src/invoice.ts into a new module src/util.ts. Update src/ledger.ts, src/report.ts and src/greet.ts to import them from ./util.ts, and have src/invoice.ts import what it still needs from there. Do not re-export the helpers from src/invoice.ts. Behaviour must not change and all tests must still pass.',
    allowed: [
      'src/util.ts',
      'src/invoice.ts',
      'src/ledger.ts',
      'src/report.ts',
      'src/greet.ts',
      'test/**',
      'README.md',
    ],
    suiteFailsBefore: false,
  },
  {
    id: 'T5',
    exercises: 'named files skip the Architect',
    set: 'standard',
    folder: 't5',
    title: 'Percent labels',
    kind: 'parallel-friendly',
    prompt:
      "Make three changes. (1) Create src/percent.ts exporting formatPercent(ratio: number): string, which formats a ratio as a percentage with one decimal, so formatPercent(0.125) is '12.5%'. (2) In src/report.ts add shareLine(entries, category) that returns the title-cased category and its formatted share, e.g. 'Food: 25.0%', using categoryShare and formatPercent. (3) In src/invoice.ts add discountLabel(invoice) that returns e.g. 'Discount 10.0%' from invoice.discountRate using formatPercent. Changes 2 and 3 touch different files and are independent of each other once formatPercent exists. Add tests for all three under test/.",
    allowed: ['src/percent.ts', 'src/report.ts', 'src/invoice.ts', 'test/**', 'README.md'],
    suiteFailsBefore: false,
  },
  {
    id: 'H1',
    exercises: 'vague request: Architect rule and Jev’s Architect pick',
    set: 'hard',
    folder: 'h1',
    title: 'Half-cent rounding',
    kind: 'subtle bug across files',
    prompt:
      'Customers report amounts that are off by a cent. Half-cent values sometimes round down (roundTo(1.005, 2) gives 1 instead of 1.01), and refunds, which are negative amounts, do not round the same way as the matching charges. Money must always round half away from zero, everywhere the library rounds an amount or a parsed value. Fix it in the source and keep all existing tests passing.',
    allowed: ['src/**', 'test/**'],
    suiteFailsBefore: false,
  },
  {
    id: 'H2',
    exercises: 'files named, few modules: short-plan Architect',
    set: 'hard',
    folder: 'h2',
    title: 'Split invoice.ts, keep its API',
    kind: 'refactor with a stable public API',
    prompt:
      "Split src/invoice.ts, which has grown too big. Move the invoice types and totals (LineItem, Invoice, subtotalCents, totalCents) into a new module src/invoice-totals.ts, and the text helpers roundTo and titleCase into a new module src/text.ts. Update src/ledger.ts, src/report.ts and src/greet.ts to import from the new modules. src/invoice.ts is the library's public entry point and other projects import from it, so everything it exports today, types included, must still be exported from it. Behaviour must not change and all tests must still pass.",
    allowed: [
      'src/invoice.ts',
      'src/invoice-totals.ts',
      'src/text.ts',
      'src/ledger.ts',
      'src/report.ts',
      'src/greet.ts',
      'test/**',
      'README.md',
    ],
    suiteFailsBefore: false,
  },
  {
    id: 'H3',
    exercises: 'migration wording (fixed); scope and one-spot skip',
    set: 'hard',
    folder: 'h3',
    title: 'Ledger file migration',
    kind: 'migration, code and tests',
    prompt:
      'Ledger files are moving to a new format. Add src/storage.ts with loadLedger(text: string): Entry[], which reads either format; saveLedger(entries: Entry[]): string, which always writes the new format; and migrateLedger(text: string): string, which converts an old file to the new format. A file that is already version 2 is returned exactly as given, character for character: migrateLedger does not normalise its categories or reformat it, though it still throws if the file is not a valid version 2 file. The old format (version 1) is a JSON array of { "category": string, "amount": string }, where amount is a dollar string such as "$1,234.50". The new format (version 2) is a JSON object { "version": 2, "entries": [{ "category": string, "cents": number }] }. Loading either format trims and lower-cases categories, and a version 1 entry with an empty or missing category gets the category "uncategorized". Anything else, such as another version number, invalid JSON or an amount that is not a number, throws an Error. Add tests in test/storage.test.ts and list the new module in the README.',
    allowed: ['src/storage.ts', 'src/money.ts', 'src/ledger.ts', 'test/**', 'README.md'],
    suiteFailsBefore: false,
  },
];

export const TASKS: readonly BenchTask[] = [...BASE_TASKS, ...ROUND3_TASKS, ...LEAN_TASKS];

export function taskById(id: string): BenchTask {
  const task = TASKS.find((candidate) => candidate.id === id.toUpperCase());
  if (!task) throw new Error(`Unknown benchmark task ${id}.`);
  return task;
}
