# Contributing to Spark Outpost

Thanks for helping. Spark Outpost is a local-first Mac app for running coding agents; read [AGENTS.md](AGENTS.md) before changing anything. It holds the product rules and the code conventions, and it applies to people and coding agents alike.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Set up

You need macOS, Node.js 24, pnpm 12 and PostgreSQL 17. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the first run and every command.

```bash
pnpm install
pnpm db:setup && pnpm db:up && pnpm db:migrate
pnpm dev
```

## Make a change

- Keep a pull request to one coherent change, and keep handwritten files at or below 500 lines.
- Add no explanatory code comments; use clear names and small functions, and put the reasoning in the pull request description.
- Test behaviour, not implementation. A new browser spec goes in `tests/browser/spec-map.ts`.
- A change to a UI label, setting, card, Spark tool, agent mode, protected path or what leaves the computer updates the page in `docs/guide/` that documents it, and every user-visible change adds a row to `docs/guide/whats-new.md`.
- Never commit secrets, `.local/` or `.env` files. Use obviously fake values in tests.

## Check it

```bash
pnpm check
pnpm test:changed
pnpm test:db:changed
pnpm test:browser:changed
```

CI runs `pnpm check`, `pnpm test:db` and the browser specs in eight shards on every pull request; see [docs/architecture/CI.md](docs/architecture/CI.md). A pull request merges once `ci-ok` passes and every review conversation is resolved.

## Pull requests

- Branch from `main` and open the pull request against `main`. We merge with merge commits.
- Describe what changed, why, how you tested it and what you could not verify.
- Spark Outpost is under the [MIT License](LICENSE); your contribution is licensed the same way.
