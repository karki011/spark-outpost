import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { append, replace } from './solution-edits.ts';

type Solution = (repo: string) => Promise<void>;

const LINE_TOTALS = `
export function lineTotalsCents(invoice: Invoice): number[] {
  const exact = invoice.items.map((item) => item.cents * item.quantity * (1 - invoice.discountRate));
  const lines = exact.map((value) => Math.floor(value));
  let left = totalCents(invoice) - lines.reduce((sum, line) => sum + line, 0);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left === 0) break;
    const step = left > 0 ? 1 : -1;
    lines[index]! += step;
    left -= step;
  }
  return lines;
}
`;

const SCHEDULE = `
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function scheduleDates(start: Date, count: number, everyMonths: number): Date[] {
  if (!Number.isInteger(count) || count < 0) throw new Error('count must be a whole number.');
  if (!Number.isInteger(everyMonths) || everyMonths < 1) {
    throw new Error('everyMonths must be a whole number of 1 or more.');
  }
  const day = start.getUTCDate();
  const timeOfDay = start.getTime() - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), day);
  return Array.from({ length: count }, (_, index) => {
    const months = start.getUTCMonth() + index * everyMonths;
    const year = start.getUTCFullYear() + Math.floor(months / 12);
    const month = months % 12;
    const date = Date.UTC(year, month, Math.min(day, lastDay(year, month)));
    return new Date(date + timeOfDay);
  });
}
`;

const SCHEDULE_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleDates } from '../src/dates.ts';

test('schedules monthly payments', () => {
  assert.equal(scheduleDates(new Date('2024-01-31T00:00:00Z'), 2, 1)[1]?.toISOString(), '2024-02-29T00:00:00.000Z');
});
`;

const CLEANUP = `import { loadLedger, saveLedger } from './storage.ts';

export function cleanLedger(text: string): { text: string; removed: number } {
  const entries = loadLedger(text);
  const seen = new Set<string>();
  const kept = entries.filter((entry) => {
    const key = \`\${entry.category}\\u0000\${entry.cents}\`;
    if (entry.cents === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { text: saveLedger(kept), removed: entries.length - kept.length };
}
`;

const CLEANUP_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanLedger } from '../src/cleanup.ts';

test('drops zero entries', () => {
  assert.equal(cleanLedger('{"version":2,"entries":[{"category":"a","cents":0}]}').removed, 1);
});
`;

const PARSE = `export function parseCents(text: string): number {
  const trimmed = text.trim();
  const wrapped = /^\\((.*)\\)$/.exec(trimmed);
  const inner = wrapped ? wrapped[1]! : trimmed;
  const cleaned = inner.replace(/[$,\\s]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value) || /[()]/.test(inner)) {
    throw new Error(\`Not an amount: \${text}\`);
  }
  if (wrapped && cleaned.startsWith('-')) throw new Error(\`Not an amount: \${text}\`);
  const cents = Math.round(value * 100);
  return wrapped ? -cents : cents;
}
`;

const CSV = `import type { Entry } from './ledger.ts';

function field(text: string): string {
  return /[",\\n]/.test(text) ? \`"\${text.replace(/"/g, '""')}"\` : text;
}

export function entriesToCsv(entries: Entry[]): string {
  return ['category,cents', ...entries.map((entry) => \`\${field(entry.category)},\${entry.cents}\`)].join('\\n');
}
`;

const REMINDERS = `import { addDays, daysBetween } from './dates.ts';
import type { Invoice } from './invoice.ts';

function days(count: number): string {
  return count === 1 ? '1 day' : \`\${count} days\`;
}

export function reminderText(invoice: Invoice, termsDays: number, today: Date): string {
  const left = daysBetween(today, addDays(invoice.issued, termsDays));
  if (left === 0) return \`Invoice \${invoice.id} is due today\`;
  if (left > 0) return \`Invoice \${invoice.id} is due in \${days(left)}\`;
  return \`Invoice \${invoice.id} is \${days(-left)} overdue\`;
}
`;

const DAYS_BETWEEN = `
export function daysBetween(from: Date, to: Date): number {
  const day = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((day(to) - day(from)) / DAY_MS);
}
`;

const REPORT_CSV = `
export function reportCsv(entries: Entry[]): string {
  const sorted = [...entries].sort(
    (a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.cents - b.cents),
  );
  return entriesToCsv(sorted);
}
`;

const SMOKE = (module: string, name: string) => `import assert from 'node:assert/strict';
import test from 'node:test';
import * as subject from '../src/${module}.ts';

test('${name} exists', () => {
  assert.equal(typeof subject.${name}, 'function');
});
`;

export const ROUND3_SOLUTIONS: Record<'H4' | 'H5' | 'D1' | 'D2' | 'R1' | 'P1', Solution> = {
  async H4(repo) {
    await append(repo, 'src/invoice.ts', LINE_TOTALS);
  },
  async H5(repo) {
    await append(repo, 'src/dates.ts', SCHEDULE);
    await writeFile(join(repo, 'test/schedule.test.ts'), SCHEDULE_TEST);
  },
  async D1(repo) {
    await writeFile(join(repo, 'src/cleanup.ts'), CLEANUP);
    await writeFile(join(repo, 'test/cleanup.test.ts'), CLEANUP_TEST);
    await replace(repo, 'src/ledger.ts', /\nexport function averageCents[\s\S]*$/, '');
    await replace(repo, 'src/ledger.ts', "import { roundTo } from './invoice.ts';\n\n", '');
    await replace(repo, 'test/ledger.test.ts', 'averageCents, ', '');
    await replace(repo, 'test/ledger.test.ts', /\n {2}assert\.equal\(averageCents[^\n]*/, '');
  },
  async D2(repo) {
    await writeFile(join(repo, 'src/cleanup.ts'), CLEANUP);
    await writeFile(join(repo, 'test/cleanup.test.ts'), CLEANUP_TEST);
    const cleaned =
      '{"version":2,"entries":[{"category":"rent","cents":150000},{"category":"food","cents":1250},{"category":"food","cents":1300},{"category":"uncategorized","cents":400},{"category":"refund","cents":-500}]}';
    await writeFile(join(repo, 'data/ledger.json'), cleaned);
  },
  async R1(repo) {
    await replace(repo, 'src/money.ts', /export function parseCents[\s\S]*$/, PARSE);
    await append(
      repo,
      'test/money.test.ts',
      "\ntest('parses parentheses as negative', () => {\n  assert.equal(parseCents('($1.00)'), -100);\n});\n",
    );
  },
  async P1(repo) {
    await writeFile(join(repo, 'src/csv.ts'), CSV);
    await writeFile(join(repo, 'src/reminders.ts'), REMINDERS);
    await append(repo, 'src/dates.ts', DAYS_BETWEEN);
    await replace(
      repo,
      'src/report.ts',
      "import { formatCents } from './money.ts';",
      "import { formatCents } from './money.ts';\nimport { entriesToCsv } from './csv.ts';",
    );
    await append(repo, 'src/report.ts', REPORT_CSV);
    await writeFile(join(repo, 'test/csv.test.ts'), SMOKE('csv', 'entriesToCsv'));
    await writeFile(join(repo, 'test/reminders.test.ts'), SMOKE('reminders', 'reminderText'));
  },
};
