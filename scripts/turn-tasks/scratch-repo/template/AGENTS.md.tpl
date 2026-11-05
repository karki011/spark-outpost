# Ledger scratch project

A small TypeScript library for order totals. It exists only to be worked on by coding agents.

## Commands

- `npm test` runs every test. `npm run test:pricing`, `npm run test:stock` and `npm run test:text` run one suite.
- `npm run lint` runs the linter. `npm run typecheck` runs the type check.
- `npm run ticker` prints one line a second for 90 seconds.
- `npm run check:slow` checks `data/catalog.json`. It takes 15 minutes.
- `npm run dev` starts the dev server. It prints its address.

## Rules

- Source lives in `src/`, tests in `test/`. Imports name the `.ts` file.
- Use `===` and `!==`. Do not use `console` in `src/`.
- Do not change `.env`, this file, the scripts in `scripts/` or the git setup.
