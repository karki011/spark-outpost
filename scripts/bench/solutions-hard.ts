import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { append, replace } from './solution-edits.ts';

type Solution = (repo: string) => Promise<void>;

const HALF_AWAY = `
export function roundHalfAway(value: number): number {
  const rounded = Math.round(Number(Math.abs(value).toPrecision(15)));
  return value < 0 ? -rounded : rounded;
}
`;

const TOTALS = `export interface LineItem {
  description: string;
  cents: number;
  quantity: number;
}

export interface Invoice {
  id: string;
  customer: string;
  issued: Date;
  items: LineItem[];
  discountRate: number;
}

export function subtotalCents(invoice: Invoice): number {
  return invoice.items.reduce((sum, item) => sum + item.cents * item.quantity, 0);
}

export function totalCents(invoice: Invoice): number {
  return Math.round(subtotalCents(invoice) * (1 - invoice.discountRate));
}
`;

const TEXT = `export function roundTo(value: number, places: number): number {
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

const INVOICE = `import { addDays, formatIsoDate } from './dates.ts';
import { totalCents, type Invoice } from './invoice-totals.ts';
import { formatCents } from './money.ts';
import { titleCase } from './text.ts';

export { subtotalCents, totalCents, type Invoice, type LineItem } from './invoice-totals.ts';
export { roundTo, titleCase } from './text.ts';

export function invoiceHeader(invoice: Invoice): string {
  return \`\${invoice.id} · \${titleCase(invoice.customer)} · \${formatCents(totalCents(invoice))}\`;
}

export function dueLabel(invoice: Invoice, termsDays: number): string {
  return \`Due \${formatIsoDate(addDays(invoice.issued, termsDays))}\`;
}
`;

const STORAGE = `import type { Entry } from './ledger.ts';
import { parseCents } from './money.ts';

function category(value: unknown): string {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text || 'uncategorized';
}

function fromV1(rows: unknown[]): Entry[] {
  return rows.map((row) => {
    const { category: name, amount } = row as { category?: unknown; amount?: unknown };
    if (typeof amount !== 'string') throw new Error('An amount is missing.');
    return { category: category(name), cents: parseCents(amount) };
  });
}

function fromV2(data: { version?: unknown; entries?: unknown }): Entry[] {
  if (data.version !== 2 || !Array.isArray(data.entries)) throw new Error('Unknown ledger format.');
  return data.entries.map((row) => {
    const { category: name, cents } = row as { category?: unknown; cents?: unknown };
    if (typeof cents !== 'number') throw new Error('A cents value is missing.');
    return { category: category(name), cents };
  });
}

export function loadLedger(text: string): Entry[] {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return fromV1(data);
  if (data && typeof data === 'object') return fromV2(data);
  throw new Error('Unknown ledger format.');
}

export function saveLedger(entries: Entry[]): string {
  return JSON.stringify({ version: 2, entries });
}

export function migrateLedger(text: string): string {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) {
    loadLedger(text);
    return text;
  }
  return saveLedger(fromV1(data));
}
`;

const STORAGE_TEST = `import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLedger, saveLedger } from '../src/storage.ts';

test('round-trips a ledger', () => {
  const entries = [{ category: 'food', cents: 5 }];
  assert.deepEqual(loadLedger(saveLedger(entries)), entries);
});
`;

export const HARD_SOLUTIONS: Record<'H1' | 'H2' | 'H3', Solution> = {
  async H1(repo) {
    await append(repo, 'src/money.ts', HALF_AWAY);
    await replace(
      repo,
      'src/money.ts',
      'return Math.round(value * 100);',
      'return roundHalfAway(value * 100);',
    );
    await replace(
      repo,
      'src/invoice.ts',
      "import { formatCents } from './money.ts';",
      "import { formatCents, roundHalfAway } from './money.ts';",
    );
    await replace(
      repo,
      'src/invoice.ts',
      'return Math.round(value * factor) / factor;',
      'return roundHalfAway(value * factor) / factor;',
    );
    await replace(
      repo,
      'src/invoice.ts',
      'return Math.round(subtotalCents(invoice) * (1 - invoice.discountRate));',
      'return roundHalfAway(subtotalCents(invoice) * (1 - invoice.discountRate));',
    );
  },
  async H2(repo) {
    await writeFile(join(repo, 'src/invoice-totals.ts'), TOTALS);
    await writeFile(join(repo, 'src/text.ts'), TEXT);
    await writeFile(join(repo, 'src/invoice.ts'), INVOICE);
    for (const file of ['src/ledger.ts', 'src/report.ts', 'src/greet.ts']) {
      await replace(repo, file, './invoice.ts', './text.ts');
    }
  },
  async H3(repo) {
    await writeFile(join(repo, 'src/storage.ts'), STORAGE);
    await writeFile(join(repo, 'test/storage.test.ts'), STORAGE_TEST);
    const readme = join(repo, 'README.md');
    const text = await readFile(readme, 'utf8');
    await writeFile(
      readme,
      `${text}- \`src/storage.ts\` loads, saves and migrates ledger files.\n`,
    );
  },
};
