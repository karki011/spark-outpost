# Electron plan

> **Status: step 2 built (dev-runnable shell, not packaged).** Steps 1 (F-24, F-9) and 2 are done; step 3, packaging, is next. See [Step 2: the shell today](#step-2-the-shell-today). AGENTS.md sets the direction: Electron is a thin wrapper around the unchanged web app and Node service.

## Decided

### Process layout

| Today                                   | In Electron                                    |
| --------------------------------------- | ---------------------------------------------- |
| Browser tab (UI)                        | Renderer process, the same React app           |
| API server                              | Its own process, started with `utilityProcess` |
| Workflow worker (agents, code scan)     | Its own process                                |
| Postgres (installed by `pnpm db:setup`) | Bundled Postgres, started as a child process   |

No server work runs in Electron's main process. It drives the windows, menus and shortcuts, so blocking it freezes the app. A slow scan or agent can only delay its own task.

### Database: keep Postgres, bundle it

The server depends on `LISTEN/NOTIFY` (live updates between the API and the worker), `FOR UPDATE SKIP LOCKED` (the job queue) and 39 migrations. PGlite allows one connection per instance, and our API and worker are separate processes. SQLite would mean rewriting the migrations, the live-update channel and the job queue. See [ROUTING_PLAN.md](ROUTING_PLAN.md), section 10.

- **Source:** pin one [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) version (its current release is a beta), or ship the same per-platform binaries ourselves. About 30–40 MB per platform.
- **Data:** in the app's folder, `~/Library/Application Support/Spark Outpost` on macOS, never inside a project.
- **Port:** a random free port on 127.0.0.1, chosen at each launch.

### Local API security (F-9)

Today the API accepts requests only for its own host and from allowed web origins. That stops web pages, but any other program on the machine can still call it, and the app runs commands and will push to GitHub.

- The API and the stream require a **token created at each launch**. The main process passes it to the window, and the token never reaches logs, files or anything an agent can see.
- The API listens on a random free port, not a fixed one.

How it works today (web milestone):

- Every HTTP request, the event streams, uploads and the terminal socket need the `X-Spark-Token` header; anything else gets 401. The host and origin checks still run first. The server compares SHA-256 digests with `timingSafeEqual`.
- A launcher can hand the API its token in `SPARK_API_TOKEN`; the API removes it from its environment before it starts anything, so agents and shells never inherit it. Playwright and `pnpm e2e:live` do this, and the Electron main process will too, injecting the header into its window's requests.
- Without a launcher (`pnpm dev`), the API creates a random token and writes it to `.local/api-token` with mode 0600. The Vite dev proxy reads that file for each proxied `/api` request and socket upgrade and adds the header, so the browser's JavaScript never holds the token and `EventSource` needs no query string. Agents are denied reading any `api-token` file like other secret files.
- In development the Vite server on 127.0.0.1 is the gate: a local program that calls Vite instead of the API still gets through. The Electron build has no dev proxy and closes this.
- API keys stay in the system keychain, as today.

### Migrations at startup (F-24)

Users can't run `pnpm db:migrate`. At startup:

1. One process takes a lock and checks for pending migrations; the other waits.
2. If any are pending, it backs up the database first and keeps the last few backups.
3. It applies them. A failure stops startup with a readable error and keeps the backup.

The same change fixes the dev problem where a pull with a new migration crashed the API (502s).

### git: use the system's

The code scan, worktrees and Ship all need git. The app detects it at startup and shows install steps if it's missing (`xcode-select --install` on macOS). No bundled git.

### Native pieces

- **ripgrep** (`@vscode/ripgrep`): a native binary per platform, unpacked from the app archive (`asarUnpack`), as VS Code does.
- **tree-sitter** (`web-tree-sitter` + `@vscode/tree-sitter-wasm`): WebAssembly, no rebuild for Electron.
- **Postgres**: per-platform binaries, as above.

### Isolation: the app you use vs the app you build

The user works in the installed app every day while developing Spark Outpost. Nothing a dev build, a test or an agent does may touch the installed app's data. Each copy runs as its own **channel**:

|                    | Installed app                           | Dev app (from a worktree)                             | Web dev stack (`pnpm dev`)        | Tests                 |
| ------------------ | --------------------------------------- | ----------------------------------------------------- | --------------------------------- | --------------------- |
| Name and app ID    | Spark Outpost                           | Spark Outpost Dev (own app ID, "DEV" badge, own icon) | –                                 | –                     |
| Data folder        | `…/Application Support/Spark Outpost`   | `…/Application Support/Spark Outpost Dev`             | `.local/` in the checkout         | temp folders          |
| Database           | bundled Postgres, own data dir and port | own bundled Postgres, own data dir and port           | `spark_outpost`                   | `spark_outpost_test*` |
| API port and token | random, per launch                      | random, per launch                                    | configured port, per-launch token | per test              |
| Keychain entries   | `Spark Outpost` service                 | `Spark Outpost Dev` service                           | dev service name                  | none (fake keys)      |
| Link scheme        | `spark-outpost://`                      | `spark-outpost-dev://`                                | –                                 | –                     |
| Updates            | auto-update                             | never                                                 | –                                 | –                     |

Shared on purpose: the Claude and Codex CLI logins (the same accounts), and the user's repositories.

Because both apps can work in the same repositories:

- **Branches and worktrees are named per channel** (`spark/…` vs `spark-dev/…`), and each channel keeps its worktrees under its own data folder, so neither can remove or merge the other's.
- **A repo busy in the other channel is detected** through a lock file in `.git/` naming the channel and run, so the dev app starts its task in a worktree instead of editing the same checkout.
- **Live tests that change files** run only in throwaway repos or copies, as today.

Testing with real data: the dev app can **import a copy** of the installed app's database (a one-way `pg_dump` → restore into the dev database), and it never writes back. API keys are not copied; the dev app asks for its own, or reads the installed app's keychain entries only after the user confirms.

The rule for every new feature: anything that stores data, opens a port, names a branch or registers something with the OS takes its name from the channel.

## Decide when we package

| Decision                                                     | Recommendation                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Agent adapters (`claude-agent-acp`, our patched `codex-acp`) | Bundle pinned versions, so the Codex patch always ships. Users sign in with their own Claude and Codex logins, as today. |
| Platforms                                                    | macOS first, Intel and Apple Silicon builds. Windows and Linux later.                                                    |
| Signing and updates                                          | Apple Developer ID with notarization; `electron-updater`.                                                                |
| Postgres major upgrades                                      | A `pg_upgrade` step before the bundled major version ever changes.                                                       |
| Crash reports and telemetry                                  | None by default; at most an opt-in crash report.                                                                         |
| Shell details                                                | One running copy at a time, stays in the menu bar when the window closes, links that open a chat.                        |

## Order

1. F-24 (auto-migrate with backup) and F-9 (per-launch token): useful now, in the web app. **Done.**
2. The Electron shell: renderer loading the built web app, API and worker in `utilityProcess`, bundled Postgres, git detection. **Done** (dev channel, run from source).
3. Packaging: adapters, signing, notarization, updates.

## Step 2: the shell today

`pnpm desktop:dev` builds the web app, bundles the main process with esbuild and starts Electron from `apps/desktop`. Run from source, it is always the **dev** channel; only `app.isPackaged` selects **prod**.

- **Channel** (`apps/desktop/src/channel.ts`): the one place that names the app, app ID, DEV badge, data folder, keychain service, link scheme and branch prefix. The data folder is `~/Library/Application Support/Spark Outpost Dev`; it holds the Chromium profile, `postgres/` (data dir), `postgres-password` (0600), `backups/` and `logs/`. One running copy per channel (`requestSingleInstanceLock` on the channel's userData).
- **Server hooks for the channel:** the API and worker read `KEYCHAIN_SERVICE`, `BRANCH_PREFIX` (`spark-dev/…` branches), `BACKUP_DIR` and, for the API, `WEB_ROOT`. The defaults keep `pnpm dev` unchanged (`Spark Outpost`, `spark/…`, `.local/backups`, no static files).
- **Postgres:** `embedded-postgres` pinned at `17.10.0-beta.17` (same major as the dev cluster), initdb with `--locale=C --encoding=UTF8` and `LC_ALL=en_US.UTF-8`, `listen_addresses=127.0.0.1`, no Unix socket, scram password, random free port per launch. A Postgres left running by a killed launch is stopped before starting. The library's own exit hooks are removed so shutdown order stays ours.
- **API and worker:** each runs in `utilityProcess.fork` (no server work in main) through `dist/server-entry.js`, which registers `tsx` and imports the unchanged `apps/server/src/api/main.ts` / `workflow/main.ts`. Env: `DATABASE_URL`, random `API_PORT`, `ALLOWED_ORIGINS` = the API origin, and `SPARK_API_TOKEN` (API only; the worker never sees it). F-24 migrate-at-startup runs as-is. Inherited `DATABASE_URL`, `SECRET_STORE` and similar are dropped, and `.local/credentials.env` is never loaded, so the shell cannot reach the web dev database.
- **Supervision:** a crashed API or worker restarts with backoff (0.5 s doubling to 30 s, reset after a minute up, give up after 5 quick crashes with a dialog showing its last output). An API exit before it first answers `/api/health` stops startup with that output instead of retrying (so a failing migration is not backed up and retried in a loop).
- **Window:** the API serves the built web app (`apps/web/dist`) on its own origin, so the renderer's relative `/api` calls, `EventSource` and WebSockets need no change and no runtime config. `contextIsolation`, `sandbox` on, `nodeIntegration` off; `session.webRequest.onBeforeSendHeaders` adds `X-Spark-Token` to requests for the API origin (http and ws) and strips any page-set copy elsewhere. Other links open in the browser; the window title keeps the channel name and the Dock shows the DEV badge.
- **git:** `git --version` at startup; if it fails, a dialog explains `xcode-select --install` and the app keeps running.
- **Quit** (window close, Cmd+Q, SIGINT/SIGTERM): worker and API get SIGTERM (SIGKILL after 10 s), then Postgres stops, then the app exits.

Verified on 2026-09-28 (Intel Mac, Electron 44.4.5 / Node 24.21): window loads onboarding; in-page `fetch('/api/health')` 200, `/api/setup` 200, `/api/events` stream opens; `window.require`/`process` undefined; direct `curl` without or with a wrong token gets 401; killing the worker with SIGKILL restarts it after 500 ms; quitting leaves no Electron, utility or Postgres processes. The terminal WebSocket through the injected header was not exercised live.

### Left for packaging (step 3) and later

- **Server as JS:** bundle or compile `apps/server` instead of registering `tsx` at runtime; resolve paths from `process.resourcesPath` instead of the repo root (`app.getAppPath()/../..`).
- **ripgrep:** `@vscode/ripgrep`'s `rgPath` works from source. Packaged, add `asarUnpack: ["**/node_modules/@vscode/ripgrep/bin/**"]` and map `app.asar` → `app.asar.unpacked` in `rgPath` (both `codescan/ripgrep.ts` and `codescan/git.ts`), as VS Code does. The same applies to `node-pty`'s `spawn-helper`, the Postgres binaries and the tree-sitter wasm files.
- **pg_dump:** `embedded-postgres` ships only `initdb`, `pg_ctl` and `postgres`. The pre-migration backup (F-24) finds `pg_dump` through Homebrew or PATH, which works on this dev machine but not for users; ship a matching `pg_dump` 17 or back up another way before the first migration after an update.
- **PATH for GUI launches:** an app started from Finder gets a minimal PATH; agents, git and the CLI lookup need the login shell's PATH.
- **Repo lock file** in `.git/` naming channel and run (isolation section): not built; the server has no hook for it yet (`repoBusy` only checks runs in its own database). TODO.
- **Worktrees under the channel data folder:** branches are per channel now, but copies still live in `<repo>/.spark/worktrees/<runId>`.
- **Link scheme:** `spark-outpost-dev://` is named but not registered with the OS (no handler yet).
- Own dev icon, menu bar residency when the window closes, logs to `logs/` instead of stdout, import-a-copy from the installed app's database, a dev keychain service name for `pnpm dev`, signing, notarization, `electron-updater` (prod only), bundled agent adapters.
