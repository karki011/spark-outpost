# Electron plan

> **Status: plan only.** Nothing here is built. AGENTS.md sets the direction: Electron is a thin wrapper around the unchanged web app and Node service.

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

1. F-24 (auto-migrate with backup) and F-9 (per-launch token): useful now, in the web app.
2. The Electron shell: renderer loading the built web app, API and worker in `utilityProcess`, bundled Postgres, git detection.
3. Packaging: adapters, signing, notarization, updates.
