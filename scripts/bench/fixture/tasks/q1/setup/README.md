# Ledger Lite

A tiny bookkeeping libary for invoices, ledgers and monthly reports.

## Usage

Run the tests with `npm test`. The code is plain TypeScript that Node runs directly, so there is
nothing to install.

## Modules

- `src/money.ts` formats and parses amounts in cents.
- `src/dates.ts` formats dates and adds days.
- `src/invoice.ts` totals invoices.
- `src/ledger.ts` summarises ledger entries.
- `src/report.ts` builds report lines per category.
- `src/greet.ts` greets returning customers.
- `src/shop/` prices orders: `calcTotal` adds up the order lines, and the other shop modules
  build carts, checkouts, taxes, shipping, refunds, receipts and summaries from it.
