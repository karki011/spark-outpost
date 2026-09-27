import { append } from '../bench/solution-edits.ts';
import { swap as replace, type VerifierTask } from './case.ts';

const HEAD = `import assert from 'node:assert/strict';
import test from 'node:test';
`;

const TITLE_CASE_MAP =
  '    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())';

const INVOICE = `const invoice = {
  id: 'INV-9',
  customer: 'ada',
  issued: new Date(Date.UTC(2026, 0, 30)),
  items: [{ description: 'Work', cents: 32500, quantity: 1 }],
  discountRate: 0.1,
};`;

const AVERAGE = `export function averageCents(entries: Entry[]): number {
  if (entries.length === 0) return 0;
  const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
  return roundTo(total / entries.length, 2);
}`;

const CATEGORIES = `export function categories(entries: Entry[]): string[] {
  return [...new Set(entries.map((entry) => entry.category))].sort();
}`;

const REPORT_LINE = 'return `${titleCase(category)}: ${formatCents(totalFor(entries, category))}`;';

const ledgerTest = (repo: string, name: string, body: string) =>
  append(repo, 'test/ledger.test.ts', `\ntest('${name}', () => {\n${body}\n});\n`);

const invoiceTest = async (repo: string, name: string, imported: string, body: string) => {
  await replace(repo, 'test/invoice.test.ts', 'invoiceHeader, totalCents', imported);
  await append(repo, 'test/invoice.test.ts', `\ntest('${name}', () => {\n${body}\n});\n`);
};

export const LEDGER_TASKS: readonly VerifierTask[] = [
  {
    id: 'apostrophe-names',
    prompt:
      "titleCase in src/invoice.ts should capitalise each part of hyphenated names and names with an apostrophe: 'mary-jane o'neil' becomes 'Mary-Jane O'Neil'. Add a test in test/invoice.test.ts.",
    missed: 'apostrophe names',
    hidden: `${HEAD}import { titleCase } from '../src/invoice.ts';

test('titleCase', () => {
  assert.equal(titleCase("mary-jane o'neil"), "Mary-Jane O'Neil");
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/invoice.ts',
        TITLE_CASE_MAP,
        "    .map((word) =>\n      word\n        .toLowerCase()\n        .replace(/(^|[-'])(\\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase()),\n    )",
      );
      await invoiceTest(
        repo,
        'titleCase',
        'invoiceHeader, titleCase, totalCents',
        '  assert.equal(titleCase("mary-jane o\'neil"), "Mary-Jane O\'Neil");',
      );
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/invoice.ts',
        TITLE_CASE_MAP,
        "    .map((word) =>\n      word\n        .split('-')\n        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())\n        .join('-'),\n    )",
      );
      await invoiceTest(
        repo,
        'titleCase',
        'invoiceHeader, titleCase, totalCents',
        "  assert.equal(titleCase('mary-jane watson'), 'Mary-Jane Watson');",
      );
    },
  },
  {
    id: 'due-on-receipt',
    prompt:
      "In src/invoice.ts, dueLabel's termsDays should default to 30 when it is left out, and the label should read 'Due on receipt' when termsDays is 0. Add tests.",
    missed: "'Due on receipt' at 0 days",
    hidden: `${HEAD}import { dueLabel } from '../src/invoice.ts';

${INVOICE}

test('dueLabel', () => {
  assert.equal(dueLabel(invoice), dueLabel(invoice, 30));
  assert.equal(dueLabel(invoice, 0), 'Due on receipt');
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/invoice.ts',
        'termsDays: number): string {\n',
        "termsDays = 30): string {\n  if (termsDays === 0) return 'Due on receipt';\n",
      );
      await invoiceTest(
        repo,
        'dueLabel',
        'dueLabel, invoiceHeader, totalCents',
        "  assert.equal(dueLabel(invoice), dueLabel(invoice, 30));\n  assert.equal(dueLabel(invoice, 0), 'Due on receipt');",
      );
    },
    async wrong(repo) {
      await replace(repo, 'src/invoice.ts', 'termsDays: number)', 'termsDays = 30)');
      await invoiceTest(
        repo,
        'dueLabel',
        'dueLabel, invoiceHeader, totalCents',
        '  assert.equal(dueLabel(invoice), dueLabel(invoice, 30));',
      );
    },
  },
  {
    id: 'tax-after-discount',
    prompt:
      'Add an optional taxRate to Invoice in src/invoice.ts (default 0). totalCents applies the discount first, then the tax to the discounted amount, and rounds once at the end. Add a test.',
    missed: 'tax on the discounted amount',
    hidden: `${HEAD}import { totalCents } from '../src/invoice.ts';

${INVOICE}

test('tax after discount', () => {
  assert.equal(totalCents({ ...invoice, taxRate: 0.2 }), 35100);
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/invoice.ts',
        '  discountRate: number;\n',
        '  discountRate: number;\n  taxRate?: number;\n',
      );
      await replace(
        repo,
        'src/invoice.ts',
        'return Math.round(subtotalCents(invoice) * (1 - invoice.discountRate));',
        'const discounted = subtotalCents(invoice) * (1 - invoice.discountRate);\n  return Math.round(discounted * (1 + (invoice.taxRate ?? 0)));',
      );
      await append(
        repo,
        'test/invoice.test.ts',
        "\ntest('adds tax after the discount', () => {\n  assert.equal(totalCents({ ...invoice, taxRate: 0.2 }), 35100);\n});\n",
      );
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/invoice.ts',
        '  discountRate: number;\n',
        '  discountRate: number;\n  taxRate?: number;\n',
      );
      await replace(
        repo,
        'src/invoice.ts',
        'return Math.round(subtotalCents(invoice) * (1 - invoice.discountRate));',
        'const subtotal = subtotalCents(invoice);\n  const tax = subtotal * (invoice.taxRate ?? 0);\n  return Math.round(subtotal * (1 - invoice.discountRate) + tax);',
      );
      await append(
        repo,
        'test/invoice.test.ts',
        "\ntest('adds tax', () => {\n  assert.equal(totalCents({ ...invoice, discountRate: 0, taxRate: 0.1 }), 35750);\n});\n",
      );
    },
  },
  {
    id: 'average-skips-transfers',
    prompt:
      "averageCents in src/ledger.ts should ignore entries whose category is 'transfer', and return 0 when nothing but transfers is left. Add a test.",
    missed: 'the average divides by the entries kept',
    hidden: `${HEAD}import { averageCents } from '../src/ledger.ts';

test('average ignores transfers', () => {
  assert.equal(averageCents([{ category: 'food', cents: 100 }, { category: 'transfer', cents: 900 }]), 100);
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/ledger.ts',
        AVERAGE,
        `export function averageCents(entries: Entry[]): number {
  const kept = entries.filter((entry) => entry.category !== 'transfer');
  if (kept.length === 0) return 0;
  const total = kept.reduce((sum, entry) => sum + entry.cents, 0);
  return roundTo(total / kept.length, 2);
}`,
      );
      await ledgerTest(
        repo,
        'ignores transfers',
        "  assert.equal(averageCents([{ category: 'transfer', cents: 500 }]), 0);\n  assert.equal(averageCents([{ category: 'rent', cents: 300 }, { category: 'transfer', cents: 1 }]), 300);",
      );
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/ledger.ts',
        AVERAGE,
        `export function averageCents(entries: Entry[]): number {
  const kept = entries.filter((entry) => entry.category !== 'transfer');
  if (kept.length === 0) return 0;
  const total = kept.reduce((sum, entry) => sum + entry.cents, 0);
  return roundTo(total / entries.length, 2);
}`,
      );
      await ledgerTest(
        repo,
        'ignores transfers',
        "  assert.equal(averageCents([{ category: 'transfer', cents: 500 }]), 0);",
      );
    },
  },
  {
    id: 'categories-by-total',
    prompt:
      'categories() in src/ledger.ts should list categories by total amount, largest first; categories with equal totals go in alphabetical order. Update the test.',
    missed: 'ties in alphabetical order',
    hidden: `${HEAD}import { categories } from '../src/ledger.ts';

test('ties are alphabetical', () => {
  const entries = [
    { category: 'b', cents: 100 },
    { category: 'a', cents: 100 },
    { category: 'c', cents: 300 },
  ];
  assert.deepEqual(categories(entries), ['c', 'a', 'b']);
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/ledger.ts',
        CATEGORIES,
        `export function categories(entries: Entry[]): string[] {
  const names = [...new Set(entries.map((entry) => entry.category))];
  return names.sort(
    (a, b) => totalFor(entries, b) - totalFor(entries, a) || a.localeCompare(b),
  );
}`,
      );
      await replace(repo, 'test/ledger.test.ts', "['food', 'rent']", "['rent', 'food']");
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/ledger.ts',
        CATEGORIES,
        `export function categories(entries: Entry[]): string[] {
  const names = [...new Set(entries.map((entry) => entry.category))];
  return names.sort((a, b) => totalFor(entries, b) - totalFor(entries, a));
}`,
      );
      await replace(repo, 'test/ledger.test.ts', "['food', 'rent']", "['rent', 'food']");
    },
  },
  {
    id: 'guest-greeting',
    prompt:
      "Fix the typo in the greeting in src/greet.ts, and when the name is empty or only spaces, greeting should return 'Welcome, guest!'. Add a test.",
    missed: 'a name of only spaces',
    hidden: `${HEAD}import { greeting } from '../src/greet.ts';

test('guest greeting', () => {
  assert.equal(greeting('   '), 'Welcome, guest!');
  assert.equal(greeting('ada'), 'Welcome back, Ada!');
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/greet.ts',
        '  return `Welcom back',
        "  if (name.trim() === '') return 'Welcome, guest!';\n  return `Welcome back",
      );
      await append(
        repo,
        'test/greet.test.ts',
        "\ntest('greets a guest', () => {\n  assert.equal(greeting(' '), 'Welcome, guest!');\n});\n",
      );
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/greet.ts',
        '  return `Welcom back',
        "  if (name === '') return 'Welcome, guest!';\n  return `Welcome back",
      );
      await append(
        repo,
        'test/greet.test.ts',
        "\ntest('greets a guest', () => {\n  assert.equal(greeting(''), 'Welcome, guest!');\n});\n",
      );
    },
  },
  {
    id: 'share-in-report',
    prompt:
      "reportLine in src/report.ts should add the category's share as a percentage with one decimal after the amount, for example 'Food: $500.00 (25.0%)'. Update the test.",
    missed: 'one decimal in the percentage',
    hidden: `${HEAD}import { reportLine } from '../src/report.ts';

test('share with one decimal', () => {
  const entries = [
    { category: 'rent', cents: 150000 },
    { category: 'food', cents: 50000 },
  ];
  assert.equal(reportLine(entries, 'food'), 'Food: $500.00 (25.0%)');
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/report.ts',
        REPORT_LINE,
        'const share = (categoryShare(entries, category) * 100).toFixed(1);\n  return `${titleCase(category)}: ${formatCents(totalFor(entries, category))} (${share}%)`;',
      );
      await replace(repo, 'test/ledger.test.ts', "'Food: $500.00'", "'Food: $500.00 (25.0%)'");
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/report.ts',
        REPORT_LINE,
        'const share = Math.round(categoryShare(entries, category) * 100);\n  return `${titleCase(category)}: ${formatCents(totalFor(entries, category))} (${share}%)`;',
      );
      await replace(repo, 'test/ledger.test.ts', "'Food: $500.00'", "'Food: $500.00 (25%)'");
    },
  },
  {
    id: 'case-insensitive-ledger',
    prompt:
      "Make the ledger in src/ledger.ts case-insensitive: categories() treats 'Food' and 'food' as one category and lists it in lowercase, and totalFor(entries, 'food') also counts 'Food' entries. Add a test.",
    missed: 'totalFor ignores case',
    hidden: `${HEAD}import { categories, totalFor } from '../src/ledger.ts';

test('case-insensitive', () => {
  const entries = [
    { category: 'Food', cents: 100 },
    { category: 'food', cents: 50 },
  ];
  assert.deepEqual(categories(entries), ['food']);
  assert.equal(totalFor(entries, 'food'), 150);
});
`,
    async correct(repo) {
      await replace(
        repo,
        'src/ledger.ts',
        'entries.map((entry) => entry.category)',
        'entries.map((entry) => entry.category.toLowerCase())',
      );
      await replace(
        repo,
        'src/ledger.ts',
        '.filter((entry) => entry.category === category)',
        '.filter((entry) => entry.category.toLowerCase() === category.toLowerCase())',
      );
      await ledgerTest(
        repo,
        'ignores case',
        "  const mixed = [{ category: 'Food', cents: 100 }, { category: 'food', cents: 50 }];\n  assert.deepEqual(categories(mixed), ['food']);\n  assert.equal(totalFor(mixed, 'food'), 150);",
      );
    },
    async wrong(repo) {
      await replace(
        repo,
        'src/ledger.ts',
        'entries.map((entry) => entry.category)',
        'entries.map((entry) => entry.category.toLowerCase())',
      );
      await ledgerTest(
        repo,
        'ignores case',
        "  const mixed = [{ category: 'Food', cents: 100 }, { category: 'food', cents: 50 }];\n  assert.deepEqual(categories(mixed), ['food']);",
      );
    },
  },
];
