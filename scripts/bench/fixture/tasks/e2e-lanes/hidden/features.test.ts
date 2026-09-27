import assert from 'node:assert/strict';
import test from 'node:test';
import type { Invoice } from '../src/invoice.ts';

const csv = (await import('../src/csv.ts')) as {
  entriesToCsv: (entries: { category: string; cents: number }[]) => string;
};
const report = (await import('../src/report.ts')) as Record<string, unknown>;
const reminders = (await import('../src/reminders.ts')) as {
  reminderText: (invoice: Invoice, termsDays: number, today: Date) => string;
};
const dates = (await import('../src/dates.ts')) as Record<string, unknown>;

test('writes CSV with a header and quotes only where needed', () => {
  assert.equal(
    csv.entriesToCsv([
      { category: 'food', cents: 1250 },
      { category: 'a, b', cents: -5 },
      { category: 'say "hi"', cents: 0 },
      { category: 'two\nlines', cents: 1 },
    ]),
    'category,cents\nfood,1250\n"a, b",-5\n"say ""hi""",0\n"two\nlines",1',
  );
  assert.equal(csv.entriesToCsv([]), 'category,cents');
});

test('sorts the report CSV by category, then cents', () => {
  const reportCsv = report.reportCsv as (entries: { category: string; cents: number }[]) => string;
  assert.equal(
    reportCsv([
      { category: 'rent', cents: 100 },
      { category: 'food', cents: 30 },
      { category: 'food', cents: -2 },
    ]),
    'category,cents\nfood,-2\nfood,30\nrent,100',
  );
});

const invoice: Invoice = {
  id: 'INV-1',
  customer: 'ada',
  issued: new Date('2024-01-01T18:00:00Z'),
  items: [],
  discountRate: 0,
};

test('words the reminder by whole UTC days to the due date', () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(
    reminders.reminderText(invoice, 10, at('2024-01-08T09:00:00Z')),
    'Invoice INV-1 is due in 3 days',
  );
  assert.equal(
    reminders.reminderText(invoice, 10, at('2024-01-10T23:59:00Z')),
    'Invoice INV-1 is due in 1 day',
  );
  assert.equal(
    reminders.reminderText(invoice, 10, at('2024-01-11T00:01:00Z')),
    'Invoice INV-1 is due today',
  );
  assert.equal(
    reminders.reminderText(invoice, 10, at('2024-01-12T01:00:00Z')),
    'Invoice INV-1 is 1 day overdue',
  );
  assert.equal(
    reminders.reminderText(invoice, 10, at('2024-01-13T20:00:00Z')),
    'Invoice INV-1 is 2 days overdue',
  );
});

test('counts calendar days between two dates in UTC', () => {
  const daysBetween = dates.daysBetween as (from: Date, to: Date) => number;
  assert.equal(daysBetween(new Date('2024-03-10T23:00:00Z'), new Date('2024-03-11T01:00:00Z')), 1);
  assert.equal(daysBetween(new Date('2024-03-11T01:00:00Z'), new Date('2024-03-10T23:00:00Z')), -1);
  assert.equal(daysBetween(new Date('2024-02-28T00:00:00Z'), new Date('2024-03-01T12:00:00Z')), 2);
});
