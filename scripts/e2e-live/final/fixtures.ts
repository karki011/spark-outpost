const PACKAGE = JSON.stringify(
  { name: 'tiny-utils', private: true, type: 'module', scripts: { test: 'node --test' } },
  null,
  2,
);

const STRINGS = `export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}
`;

const STRINGS_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capitalize } from '../src/strings.ts';

test('capitalize', () => {
  assert.equal(capitalize('spark'), 'Spark');
  assert.equal(capitalize(''), '');
});
`;

export const BASE: Record<string, string> = {
  'package.json': `${PACKAGE}\n`,
  'README.md':
    '# tiny-utils\n\nSmall TypeScript helpers. Run `npm test` (Node runs the .ts tests directly).\n',
  'src/strings.ts': STRINGS,
  'test/strings.test.ts': STRINGS_TEST,
};

export const LINKED: Record<string, string> = {
  ...BASE,
  'src/money.ts': `export interface Money {
  cents: number;
  currency: string;
}

export function money(cents: number, currency = 'USD'): Money {
  return { cents, currency };
}

export function add(left: Money, right: Money): Money {
  return { cents: left.cents + right.cents, currency: left.currency };
}
`,
  'src/format.ts': `import type { Money } from './money.ts';

export function formatMoney(value: Money): string {
  return \`\${value.currency} \${(value.cents / 100).toFixed(2)}\`;
}
`,
  'src/cart.ts': `import { add, money, type Money } from './money.ts';

export interface Line {
  name: string;
  price: Money;
  quantity: number;
}

export function total(lines: readonly Line[]): Money {
  return lines.reduce(
    (sum, line) => add(sum, money(line.price.cents * line.quantity, line.price.currency)),
    money(0),
  );
}
`,
  'src/invoice.ts': `import { total, type Line } from './cart.ts';
import { formatMoney } from './format.ts';

export function invoice(lines: readonly Line[]): string {
  const rows = lines.map((line) => \`\${line.quantity} x \${line.name} @ \${formatMoney(line.price)}\`);
  return [...rows, \`Total: \${formatMoney(total(lines))}\`].join('\\n');
}
`,
  'src/receipt.ts': `import { formatMoney } from './format.ts';
import type { Money } from './money.ts';

export function receipt(paid: Money): string {
  return \`Paid \${formatMoney(paid)}. Thank you.\`;
}
`,
  'test/invoice.test.ts': `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoice } from '../src/invoice.ts';
import { money } from '../src/money.ts';
import { receipt } from '../src/receipt.ts';

test('invoice totals the lines', () => {
  const text = invoice([{ name: 'Tea', price: money(250), quantity: 2 }]);
  assert.match(text, /Total: USD 5\\.00/);
});

test('receipt', () => {
  assert.equal(receipt(money(500)), 'Paid USD 5.00. Thank you.');
});
`,
};
