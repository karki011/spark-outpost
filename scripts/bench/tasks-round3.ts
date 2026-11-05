import type { BenchTask } from './tasks.ts';

export const ROUND3_TASKS: readonly BenchTask[] = [
  {
    id: 'H4',
    set: 'hard',
    exercises: 'cross-module contract; Architect choice',
    folder: 'h4',
    title: 'Line totals that add up',
    kind: 'cross-module contract',
    prompt:
      'Accountants complain that the line amounts we print on invoices do not add up to the total in the invoice header. Add lineTotalsCents(invoice: Invoice): number[] to src/invoice.ts. It returns each item’s amount in whole cents after the invoice discount, in item order. The amounts must always add up exactly to totalCents(invoice), the figure invoiceHeader prints, and each amount must be within one cent of the item’s exact discounted value (cents × quantity × (1 − discountRate)). Items can be credits with negative cents, and quantities can be 0. Do not change totalCents or invoiceHeader. Add tests in test/invoice.test.ts.',
    allowed: ['src/**', 'test/**', 'README.md'],
    suiteFailsBefore: false,
  },
  {
    id: 'H5',
    set: 'hard',
    exercises: 'hidden runtime invariant (UTC, month-end drift); scope question',
    folder: 'h5',
    title: 'Month-end payment schedule',
    kind: 'tricky edge cases',
    prompt:
      'Add scheduleDates(start: Date, count: number, everyMonths: number): Date[] to src/dates.ts for recurring payments. It returns count dates: the start itself, then one every everyMonths months. Each payment falls on the start date’s day of the month, or on the last day of the month when that month is shorter, so a schedule that starts on January 31 pays on February 29 in a leap year and then on March 31. The time of day is kept. Like the rest of src/dates.ts, dates are in UTC. A count of 0 gives an empty list. count must be a whole number of 0 or more and everyMonths a whole number of 1 or more; anything else throws an Error. Add tests in test/schedule.test.ts.',
    allowed: ['src/dates.ts', 'test/**', 'README.md'],
    suiteFailsBefore: false,
  },
  {
    id: 'D1',
    set: 'hard',
    exercises: 'destructive: top-tier Architect, Critic and Codex',
    folder: 'd1',
    title: 'Delete junk ledger records',
    kind: 'destructive data migration',
    prompt:
      'Stored ledger files picked up junk: duplicate entries from a sync bug and zero-cent placeholder entries. Write the one-off cleanup migration that deletes them. Add src/cleanup.ts with cleanLedger(text: string): { text: string; removed: number }. It loads a file of either format with loadLedger from src/storage.ts, deletes every entry whose cents is 0, deletes repeated entries (the same category and cents after loading) keeping only the first of each, and returns the remaining entries written with saveLedger together with the number of deleted entries. The kept entries keep their order. A file that loadLedger rejects must throw, so nothing is deleted from it. Also delete the unused averageCents function from src/ledger.ts and its test. Add tests in test/cleanup.test.ts.',
    allowed: ['src/cleanup.ts', 'src/ledger.ts', 'test/**', 'README.md'],
    suiteFailsBefore: false,
  },
  {
    id: 'D2',
    set: 'hard',
    exercises: 'destructive (deletes stored records): top-tier Architect, Critic and Codex',
    folder: 'd2',
    title: 'Purge stored ledger records',
    kind: 'destructive data migration run on stored data',
    prompt:
      'The stored ledger in data/ledger.json picked up junk: duplicate entries from a sync bug and zero-cent placeholder entries. Permanently delete those records from it. First add src/cleanup.ts with cleanLedger(text: string): { text: string; removed: number }. It loads a file of either format with loadLedger from src/storage.ts, deletes every entry whose cents is 0, deletes repeated entries (the same category and cents after loading) keeping only the first of each, and returns the remaining entries written with saveLedger together with the number of deleted entries. The kept entries keep their order. A file that loadLedger rejects must throw, so nothing is deleted from it. Add tests in test/cleanup.test.ts. Then run cleanLedger on data/ledger.json and overwrite the file with the result.',
    allowed: ['src/cleanup.ts', 'data/ledger.json', 'test/**', 'README.md', 'scripts/**'],
    suiteFailsBefore: false,
  },
  {
    id: 'R1',
    set: 'hard',
    exercises: 'explicit review request: Critic',
    folder: 'r1',
    title: 'Review a pending change',
    kind: 'review this change',
    prompt:
      'A teammate left an uncommitted change to src/money.ts in the working tree (see git diff). It is meant to teach parseCents accounting notation: a negative amount written in parentheses, such as "($1,234.50)", parses to -123450. Parentheses must wrap the whole amount and cannot be combined with a minus sign; anything else is not an amount and throws. Everything parseCents accepted before must keep working exactly as before. Review this change before it is committed: fix every problem you find in src/money.ts, add tests for the new notation in test/money.test.ts, and reply with a short review of what was wrong.',
    allowed: ['src/money.ts', 'test/**'],
    suiteFailsBefore: false,
  },
  {
    id: 'P1',
    set: 'hard',
    exercises: 'parallel Builders: Jev parallel nouls, Files lines',
    folder: 'p1',
    title: 'Two independent features',
    kind: 'two independent multi-file steps',
    prompt:
      'Add two independent features; they share no files, so they can be built at the same time. (A) CSV export: create src/csv.ts exporting entriesToCsv(entries: Entry[]): string, using the Entry type from src/ledger.ts. It writes the header line category,cents and then one line per entry, joined with \\n and with no trailing newline. A category that contains a comma, a double quote or a newline is wrapped in double quotes, with any double quote inside doubled. Add reportCsv(entries) to src/report.ts, returning entriesToCsv of the entries sorted by category and then by cents. Add tests in test/csv.test.ts. (B) Payment reminders: create src/reminders.ts exporting reminderText(invoice: Invoice, termsDays: number, today: Date): string, using the Invoice type from src/invoice.ts. The invoice is due termsDays after invoice.issued. It returns "Invoice INV-1 is due in 3 days", "Invoice INV-1 is due today" or "Invoice INV-1 is 2 days overdue", with "day" for 1, counting calendar days in UTC and ignoring the time of day. Add daysBetween(from: Date, to: Date): number to src/dates.ts for that count. Add tests in test/reminders.test.ts.',
    allowed: [
      'src/csv.ts',
      'src/report.ts',
      'src/reminders.ts',
      'src/dates.ts',
      'test/**',
      'README.md',
    ],
    suiteFailsBefore: false,
  },
];
