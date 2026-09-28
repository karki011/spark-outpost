import { append } from '../bench/solution-edits.ts';
import { replaceLiteral, TEST_HEAD, type VerifierTask } from './case.ts';

const PARSE_CENTS = `export function parseCents(text: string): number {
  const cleaned = text.replace(/[$,\\s]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value)) throw new Error(\`Not an amount: \${text}\`);
  return Math.round(value * 100);
}`;

const FORMAT_CENTS = `export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return \`\${sign}$\${(Math.abs(cents) / 100).toFixed(2)}\`;
}`;

const addMoneyTest = async (repo: string, name: string, body: string) => {
  await replaceLiteral(repo, 'test/money.test.ts', 'parseCents }', `parseCents, ${name} }`);
  await append(repo, 'test/money.test.ts', `\ntest('${name}', () => {\n${body}\n});\n`);
};

export const MONEY_TASKS: readonly VerifierTask[] = [
  {
    id: 'percent-zero',
    prompt:
      'Add a function percentOf(part: number, total: number): number to src/money.ts. It returns part as a percentage of total rounded to one decimal place (percentOf(1, 3) is 33.3) and returns 0 when total is 0. Add a test for it in test/money.test.ts.',
    missed: 'returns 0 when total is 0',
    hidden: `${TEST_HEAD}import { percentOf } from '../src/money.ts';

test('percentOf', () => {
  assert.equal(percentOf(1, 3), 33.3);
  assert.equal(percentOf(1, 0), 0);
});
`,
    async correct(repo) {
      await append(
        repo,
        'src/money.ts',
        '\nexport function percentOf(part: number, total: number): number {\n  if (total === 0) return 0;\n  return Math.round((part / total) * 1000) / 10;\n}\n',
      );
      await addMoneyTest(
        repo,
        'percentOf',
        '  assert.equal(percentOf(1, 4), 25);\n  assert.equal(percentOf(3, 0), 0);',
      );
    },
    async wrong(repo) {
      await append(
        repo,
        'src/money.ts',
        '\nexport function percentOf(part: number, total: number): number {\n  return Math.round((part / total) * 1000) / 10;\n}\n',
      );
      await addMoneyTest(
        repo,
        'percentOf',
        '  assert.equal(percentOf(1, 4), 25);\n  assert.equal(percentOf(1, 3), 33.3);',
      );
    },
  },
  {
    id: 'parentheses-negative',
    prompt:
      "parseCents in src/money.ts should treat an amount in parentheses as negative, the way accountants write it: '(12.50)' is -1250 and '($1,000)' is -100000. Add tests.",
    missed: 'parentheses make the amount negative',
    hidden: `${TEST_HEAD}import { parseCents } from '../src/money.ts';

test('parentheses are negative', () => {
  assert.equal(parseCents('(12.50)'), -1250);
  assert.equal(parseCents('($1,000)'), -100000);
});
`,
    async correct(repo) {
      await replaceLiteral(
        repo,
        'src/money.ts',
        PARSE_CENTS,
        `export function parseCents(text: string): number {
  const negative = /^\\s*\\(.*\\)\\s*$/.test(text);
  const cleaned = text.replace(/[$,\\s()]/g, '');
  const value = Number(cleaned);
  if (cleaned === '' || Number.isNaN(value)) throw new Error(\`Not an amount: \${text}\`);
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}`,
      );
      await append(
        repo,
        'test/money.test.ts',
        "\ntest('parentheses', () => {\n  assert.equal(parseCents('(12.50)'), -1250);\n});\n",
      );
    },
    async wrong(repo) {
      await replaceLiteral(repo, 'src/money.ts', '/[$,\\s]/g', '/[$,\\s()]/g');
      await append(
        repo,
        'test/money.test.ts',
        "\ntest('parentheses', () => {\n  assert.doesNotThrow(() => parseCents('(12.50)'));\n  assert.doesNotThrow(() => parseCents('($1,000)'));\n});\n",
      );
    },
  },
  {
    id: 'thousands-groups',
    prompt:
      "formatCents in src/money.ts should group thousands with commas: 123456 is '$1,234.56' and 123456789 is '$1,234,567.89'. Negative amounts keep the sign in front ('-$1,234.56'). Update the tests.",
    missed: 'every group of thousands gets a comma',
    hidden: `${TEST_HEAD}import { formatCents } from '../src/money.ts';

test('groups thousands', () => {
  assert.equal(formatCents(123456789), '$1,234,567.89');
  assert.equal(formatCents(-123456), '-$1,234.56');
});
`,
    async correct(repo) {
      await replaceLiteral(
        repo,
        'src/money.ts',
        FORMAT_CENTS,
        `export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.');
  const grouped = whole!.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  return \`\${sign}$\${grouped}.\${fraction}\`;
}`,
      );
      await replaceLiteral(repo, 'test/money.test.ts', "'$1234.56'", "'$1,234.56'");
    },
    async wrong(repo) {
      await replaceLiteral(
        repo,
        'src/money.ts',
        FORMAT_CENTS,
        `export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.');
  const grouped = whole!.length > 3 ? \`\${whole!.slice(0, -3)},\${whole!.slice(-3)}\` : whole;
  return \`\${sign}$\${grouped}.\${fraction}\`;
}`,
      );
      await replaceLiteral(repo, 'test/money.test.ts', "'$1234.56'", "'$1,234.56'");
    },
  },
  {
    id: 'sum-skips-blanks',
    prompt:
      'Add sumCents(amounts: string[]): number to src/money.ts. It adds up the amounts using parseCents and skips blank strings. Add a test.',
    missed: 'blank strings are skipped',
    hidden: `${TEST_HEAD}import { sumCents } from '../src/money.ts';

test('sumCents skips blanks', () => {
  assert.equal(sumCents(['$1', '', '  ', '$2']), 300);
});
`,
    async correct(repo) {
      await append(
        repo,
        'src/money.ts',
        "\nexport function sumCents(amounts: string[]): number {\n  return amounts\n    .filter((amount) => amount.trim() !== '')\n    .reduce((sum, amount) => sum + parseCents(amount), 0);\n}\n",
      );
      await addMoneyTest(
        repo,
        'sumCents',
        "  assert.equal(sumCents(['$1.00', '', '$2.50']), 350);",
      );
    },
    async wrong(repo) {
      await append(
        repo,
        'src/money.ts',
        '\nexport function sumCents(amounts: string[]): number {\n  return amounts.reduce((sum, amount) => sum + parseCents(amount), 0);\n}\n',
      );
      await addMoneyTest(repo, 'sumCents', "  assert.equal(sumCents(['$1.00', '$2.50']), 350);");
    },
  },
];
