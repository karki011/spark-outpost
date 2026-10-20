# Continuous integration

GitHub Actions runs `.github/workflows/ci.yml` on every pull request and on every push to `main`. It runs the same commands a contributor runs locally; nothing in it signs, packages, publishes or deploys.

## Jobs

| Job                    | Runner       | What it runs                                                                                                                                                                   |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check`                | ubuntu-24.04 | `pnpm check`                                                                                                                                                                   |
| `db`                   | ubuntu-24.04 | `pnpm test:db` against a PostgreSQL 17 container                                                                                                                               |
| `browser (N/8)`        | ubuntu-24.04 | `pnpm exec playwright test --shard=N/8` over every spec except the `*-perf` specs, against a production build of the web app, one worker per shard                             |
| `browser (fake-hosts)` | ubuntu-24.04 | the specs that skip without a fake host: `calendar*.spec.ts` and `browser-agent`, `shot-order`, `sign-ins`, `sign-in-sites`, with `SPARK_FAKE_CALENDAR=1 SPARK_FAKE_BROWSER=1` |
| `swift (<helper>)`     | macos-15     | `pnpm desktop:mac-control --test`, `pnpm desktop:calendar --test` and `pnpm desktop:voice --test`, only when a Swift helper or its build script changed                        |
| `changes`              | ubuntu-24.04 | decides whether the Swift jobs run                                                                                                                                             |
| `ci-ok`                | ubuntu-24.04 | fails unless every job above passed or was skipped; this is the check branch protection requires                                                                               |

- **Setup** (`.github/actions/setup`): pnpm from `packageManager`, Node from `.nvmrc` with the pnpm store cached, `pnpm install --frozen-lockfile`, and a git identity for tests that commit. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` keeps the Electron binary out of every job.
- **Database** (`.github/actions/postgres`): `postgres:17`, pinned by digest, on `127.0.0.1:5432` with the C locale (as `pnpm db:setup` creates it) and `max_connections=300`. `TEST_DATABASE_URL` and `DATABASE_URL` point at `spark_outpost_test` with a throwaway password that exists only in CI. Each browser shard is its own runner, so it gets its own database and the slot 0 ports.
- **Browser shards** build the web app once with `VITE_SPARK_FEEDBACK_EMAIL=beta-feedback@example.test` and run with `SPARK_WEB_BUILD=1 SPARK_WEB_PREBUILT=1`, as `pnpm test:browser:shards` does. Playwright's Chromium is cached by Playwright version. On failure each shard uploads `playwright-report/` and `test-results/` (traces and the API and worker logs under `test-results/server-logs/`) as `playwright-report-<job index>`, kept 14 days.
- **Perf specs** (`pnpm test:browser:perf`) are left out: their 50 ms task budgets measure the machine, and shared runners vary too much. Run them locally.
- **macOS** runs only the Swift helper tests, which need the Xcode toolchain. Everything else runs on Linux.

## Security

- Every action is pinned to a full commit SHA, with its release tag after it for Dependabot (`.github/dependabot.yml`, weekly).
- The workflow's token is `contents: read`; only `changes` adds `pull-requests: read` to list a pull request's files. Checkouts don't keep the token (`persist-credentials: false`).
- No job reads a repository secret, and there is no `pull_request_target` trigger, so a pull request from a fork runs with a read-only token and no secrets.

## Releases, later

Signing, notarization and publishing stay manual (`docs/architecture/RELEASES.md`). If they move to Actions, they belong in a separate workflow that runs only on a tag or a manual dispatch from `main`, in a protected `release` environment with required reviewers, holding the Developer ID certificate, the notarization credentials and the update feed keys as environment secrets. It would run on macOS and never on a `pull_request` event.

## Run it locally

The jobs map to `pnpm check`, `pnpm test:db`, `pnpm test:browser:shards` and `pnpm desktop:<helper> --test`. Lint the workflow with `actionlint` (`brew install actionlint`).
