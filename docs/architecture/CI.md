# Continuous integration

GitHub Actions runs `.github/workflows/ci.yml` on demand (`workflow_dispatch`, Actions → CI → Run workflow) and, once the repository is public, on every pull request and every push to `main`. While the repository is private, a pull request or push starts a run whose jobs all skip, so it spends no minutes. It runs the same commands a contributor runs locally; nothing in it signs, packages, publishes or deploys. One run per ref: a new push cancels the run it supersedes.

## Jobs

| Job                    | Runner        | What it runs                                                                                                                                                                                       |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check`                | ubuntu-latest | `pnpm check`                                                                                                                                                                                       |
| `db (N/3)`             | ubuntu-latest | `pnpm test:db --shard=N/3 --maxWorkers=4` against a PostgreSQL 17 container                                                                                                                        |
| `browser (N/8)`        | ubuntu-latest | `pnpm exec playwright test --shard=N/8 --retries=1 --reporter=list,html` over every spec except the `*-perf` specs, against a production build of the web app, one worker per shard                |
| `browser (fake-hosts)` | ubuntu-latest | the specs that skip without a fake host (`calendar*.spec.ts`, `browser-agent`, `island-ask-calendar`, `shot-order`, `sign-ins`, `sign-in-sites`) with `SPARK_FAKE_CALENDAR=1 SPARK_FAKE_BROWSER=1` |
| `swift (<helper>)`     | macos-15      | `pnpm desktop:mac-control --test`, `pnpm desktop:calendar --test` and `pnpm desktop:voice --test`: on a manual run, or when a helper changed and the repository is public                          |
| `changes`              | ubuntu-latest | decides whether a Swift helper changed                                                                                                                                                             |
| `ci-ok`                | ubuntu-latest | fails unless every job above passed or was skipped                                                                                                                                                 |

- **Setup** (`.github/actions/setup`): pnpm from `packageManager`, Node from `.nvmrc` with the pnpm store cached, `pnpm install --frozen-lockfile`, and a git identity for tests that commit. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` keeps the Electron binary out of every job. On Linux it also matches what the tests expect from a Mac: zsh as `SHELL`, and unprivileged user namespaces, which Codex's sandbox (bubblewrap) needs and Ubuntu 24.04 restricts by default.
- **Database** (`.github/actions/postgres`): `postgres:17`, pinned by digest, on `127.0.0.1:5432` with the C locale (as `pnpm db:setup` creates it) and `max_connections=300`. `TEST_DATABASE_URL` and `DATABASE_URL` point at `spark_outpost_test` with a throwaway password that exists only in CI. Each shard is its own runner, so it gets its own database and the slot 0 ports.
- **Browser shards** build the web app once with `VITE_SPARK_FEEDBACK_EMAIL=beta-feedback@example.test` and run with `SPARK_WEB_BUILD=1 SPARK_WEB_PREBUILT=1`, as `pnpm test:browser:shards` does. Playwright's Chromium is cached by Playwright version. A spec that fails and then passes on its one retry is reported as flaky in the run, not hidden. On failure each shard uploads `playwright-report/` and `test-results/` (traces and the API and worker logs under `test-results/server-logs/`) as `playwright-report-<job index>`, kept 14 days.
- **Left out**: the perf specs (`pnpm test:browser:perf`), whose 50 ms task budgets measure the machine; run them locally.
- **macOS only**: a few tests check behaviour that exists only on a Mac and skip elsewhere: Control+D reaching a terminal session, Option-select in the terminal and the zsh login shell start-up. `pnpm check` and `pnpm test:browser` on a Mac still run them.

## Minutes

While the repository is private, the free plan has 2,000 Actions minutes a month and counts macOS minutes ten times, so CI runs only when started by hand. Standard Linux runners on a private repository have 2 CPUs, which is why the db tests are sharded and the browser specs get one retry. A run uses roughly 150–200 Linux minutes. Once the repository is public, standard runners are free and have 4 CPUs, and the Swift jobs run whenever a helper changes.

## Security

- Every action is pinned to a full commit SHA, with its release tag after it for Dependabot (`.github/dependabot.yml`, weekly).
- The workflow's token is `contents: read`; only `changes` adds `pull-requests: read` to list a pull request's files. Checkouts don't keep the token (`persist-credentials: false`).
- No job reads a repository secret, and there is no `pull_request_target` trigger, so a pull request from a fork runs with a read-only token and no secrets.

## Releases, later

Signing, notarization and publishing stay manual (`docs/architecture/RELEASES.md`). If they move to Actions, they belong in a separate workflow that runs only on a tag or a manual dispatch from `main`, in a protected `release` environment with required reviewers, holding the Developer ID certificate, the notarization credentials and the update feed keys as environment secrets. It would run on macOS and never on a `pull_request` event.

## Run it locally

The jobs map to `pnpm check`, `pnpm test:db`, `pnpm test:browser:shards` and `pnpm desktop:<helper> --test`. Lint the workflow with `actionlint` (`brew install actionlint`).
