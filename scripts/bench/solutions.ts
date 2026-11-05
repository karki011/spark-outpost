import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { append, replace } from './solution-edits.ts';
import { HARD_SOLUTIONS } from './solutions-hard.ts';
import { LEAN_SOLUTIONS } from './solutions-lean.ts';
import { ROUND3_SOLUTIONS } from './solutions-round3.ts';
import type { BenchTaskId } from './tasks.ts';

const UTIL = `export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function titleCase(text: string): string {
  return text
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
`;

const PERCENT_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { discountLabel } from '../src/invoice.ts';
import { formatPercent } from '../src/percent.ts';
import { shareLine } from '../src/report.ts';

test('labels', () => {
  assert.equal(formatPercent(0.5), '50.0%');
  assert.equal(shareLine([{ category: 'a', cents: 1 }], 'a'), 'A: 100.0%');
  assert.equal(
    discountLabel({ id: 'i', customer: 'c', issued: new Date(0), items: [], discountRate: 0 }),
    'Discount 0.0%',
  );
});
`;

export const REFERENCE_SOLUTIONS: Record<BenchTaskId, (repo: string) => Promise<void>> = {
  async T1(repo) {
    await replace(repo, 'src/greet.ts', 'Welcom back', 'Welcome back');
    await replace(repo, 'README.md', 'libary', 'library');
  },
  async T2(repo) {
    await replace(repo, 'src/dates.ts', 'pad(date.getUTCMonth())', 'pad(date.getUTCMonth() + 1)');
  },
  async T3(repo) {
    await append(
      repo,
      'src/money.ts',
      '\nexport function percentOf(part: number, total: number): number {\n  if (total === 0) return 0;\n  return Math.round((part / total) * 1000) / 10;\n}\n',
    );
    await replace(repo, 'test/money.test.ts', 'parseCents }', 'parseCents, percentOf }');
    await append(
      repo,
      'test/money.test.ts',
      "\ntest('percentOf', () => {\n  assert.equal(percentOf(1, 4), 25);\n});\n",
    );
  },
  async T4(repo) {
    await writeFile(join(repo, 'src/util.ts'), UTIL);
    await replace(
      repo,
      'src/invoice.ts',
      /export function roundTo[\s\S]*?\.join\(' '\);\n}\n\n/,
      '',
    );
    await replace(
      repo,
      'src/invoice.ts',
      "import { formatCents } from './money.ts';",
      "import { formatCents } from './money.ts';\nimport { titleCase } from './util.ts';",
    );
    await replace(repo, 'src/ledger.ts', './invoice.ts', './util.ts');
    await replace(repo, 'src/report.ts', './invoice.ts', './util.ts');
    await replace(repo, 'src/greet.ts', './invoice.ts', './util.ts');
  },
  async T5(repo) {
    await writeFile(
      join(repo, 'src/percent.ts'),
      'export function formatPercent(ratio: number): string {\n  return `${(ratio * 100).toFixed(1)}%`;\n}\n',
    );
    await replace(
      repo,
      'src/report.ts',
      "import { formatCents } from './money.ts';",
      "import { formatCents } from './money.ts';\nimport { formatPercent } from './percent.ts';",
    );
    await append(
      repo,
      'src/report.ts',
      '\nexport function shareLine(entries: Entry[], category: string): string {\n  return `${titleCase(category)}: ${formatPercent(categoryShare(entries, category))}`;\n}\n',
    );
    await replace(
      repo,
      'src/invoice.ts',
      "import { formatCents } from './money.ts';",
      "import { formatCents } from './money.ts';\nimport { formatPercent } from './percent.ts';",
    );
    await append(
      repo,
      'src/invoice.ts',
      '\nexport function discountLabel(invoice: Invoice): string {\n  return `Discount ${formatPercent(invoice.discountRate)}`;\n}\n',
    );
    await writeFile(join(repo, 'test/percent.test.ts'), PERCENT_TEST);
  },
  ...HARD_SOLUTIONS,
  ...ROUND3_SOLUTIONS,
  ...LEAN_SOLUTIONS,
};
