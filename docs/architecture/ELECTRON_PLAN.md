# Electron plan

> **Status: step 3 built locally, unsigned.** Steps 1 (F-24, F-9) and 2 are done. Step 3 packages an ad-hoc signed app with updates and a safe migration on update; signing, notarization and hosting wait on the user ([RELEASES.md](RELEASES.md)). See [Step 2: the shell today](#step-2-the-shell-today) and [Step 3: packaging and updates](#step-3-packaging-and-updates). AGENTS.md sets the direction: Electron is a thin wrapper around the unchanged web app and Node service.

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

The server depends on `LISTEN/NOTIFY` (live updates between the API and the worker), `FOR UPDATE SKIP LOCKED` (the job queue) and every migration (plain SQL). PGlite allows one connection per instance, and our API and worker are separate processes. SQLite would mean rewriting the migrations, the live-update channel and the job queue.

- **Source:** pin one [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) version (its current release is a beta), or ship the same per-platform binaries ourselves. About 30–40 MB per platform.
- **Data:** in the app's folder, `~/Library/Application Support/Spark Outpost` on macOS, never inside a project.
- **Port:** a random free port on 127.0.0.1, chosen at each launch.

### Local API security (F-9)

Today the API accepts requests only for its own host and from allowed web origins. That stops web pages, but any other program on the machine can still call it, and the app runs commands and will push to GitHub.

- The API and the stream require a **token created at each launch**. The main process passes it to the window, and the token never reaches logs, files or anything an agent can see.
- The API listens on a port picked at random for each install (not a fixed, well-known one); the token, not the port, is what keeps other programs out.

How it works today (web milestone):

- Every HTTP request, the event streams, uploads and the terminal socket need the `X-Spark-Token` header; anything else gets 401. The host and origin checks still run first. The server compares SHA-256 digests with `timingSafeEqual`.
- A launcher can hand the API its token in `SPARK_API_TOKEN`; the API removes it from its environment before it starts anything, so agents and shells never inherit it. Playwright and `pnpm e2e:live` do this, and the Electron main process will too, injecting the header into its window's requests.
- Without a launcher (`pnpm dev`), the API creates a random token and writes it to `.local/api-token` with mode 0600. The Vite dev proxy reads that file for each proxied `/api` request and socket upgrade and adds the header, so the browser's JavaScript never holds the token and `EventSource` needs no query string. Agents are denied reading any `api-token` file like other secret files.
- In development the Vite server on 127.0.0.1 is the gate: a local program that calls Vite instead of the API still gets through. The Electron build has no dev proxy and closes this.
- API keys stay in the system keychain, as today.

### Migrations at startup (F-24)

Users can't run `pnpm db:migrate`. At startup:

1. One process takes a lock and checks for pending migrations; the other waits.
2. If any are pending and `BACKUP_DIR` is set, it backs up the database first (`pg_dump`) and keeps the last few backups. The desktop shell sets `BACKUP_DIR` to its `backups/` folder; `pnpm dev` and test databases take no backup (`persistence/startup-backup.ts`).
3. It applies them. A failure stops startup with a readable error and keeps any backup.

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
| API port and token | stable port, per-launch token           | stable port, per-launch token                         | configured port, per-launch token | per test              |
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

| Decision                                                     | Recommendation                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent adapters (`claude-agent-acp`, our patched `codex-acp`) | Bundle pinned adapter versions, so the Codex patch always ships, but not the `claude` and `codex` CLIs: users install those, and the adapters run the user's CLI and login. |
| Platforms                                                    | macOS first, Intel and Apple Silicon builds. Windows and Linux later.                                                                                                       |
| Signing and updates                                          | Apple Developer ID with notarization; `electron-updater`.                                                                                                                   |
| Postgres major upgrades                                      | A `pg_upgrade` step before the bundled major version ever changes.                                                                                                          |
| Crash reports and telemetry                                  | No crash reports. One anonymous daily install heartbeat (install ID, version, OS, country), on by default with a switch in Settings → Help; see `infra/heartbeat-worker`.   |
| Shell details                                                | One running copy at a time, stays in the menu bar when the window closes, links that open a chat.                                                                           |

## Order

1. F-24 (auto-migrate with backup) and F-9 (per-launch token): useful now, in the web app. **Done.**
2. The Electron shell: renderer loading the built web app, API and worker in `utilityProcess`, bundled Postgres, git detection. **Done** (dev channel, run from source).
3. Packaging: adapters, signing, notarization, updates. **Built locally**; signing, notarization and hosting are the user's one-time setup in [RELEASES.md](RELEASES.md).

## Step 2: the shell today

`pnpm desktop:dev` builds the web app, bundles the main process with esbuild and starts Electron from `apps/desktop`. Run from source, it is always the **dev** channel; only `app.isPackaged` selects **prod**.

- **Channel** (`apps/desktop/src/channel.ts`): the one place that names the app, app ID, DEV badge, data folder, keychain service, link scheme and branch prefix. The data folder is `~/Library/Application Support/Spark Outpost Dev`; it holds the Chromium profile, `postgres/` (data dir), `postgres-password` (0600), `backups/` and `logs/`. One running copy per channel (`requestSingleInstanceLock` on the channel's userData).
- **Server hooks for the channel:** the API and worker read `KEYCHAIN_SERVICE`, `BRANCH_PREFIX` (`spark-dev/…` branches), `BACKUP_DIR` and, for the API, `WEB_ROOT`. The defaults keep `pnpm dev` unchanged (`Spark Outpost`, `spark/…`, no backups, no static files).
- **Postgres:** `embedded-postgres` pinned at `17.10.0-beta.17` (same major as the dev cluster), initdb with `--locale=C --encoding=UTF8` and `LC_ALL=en_US.UTF-8`, `listen_addresses=127.0.0.1`, no Unix socket, scram password, random free port per launch. A Postgres left running by a killed launch is stopped before starting. The library's own exit hooks are removed so shutdown order stays ours.
- **API and worker:** each runs in `utilityProcess.fork` (no server work in main) through `dist/server-entry.js`, which registers `tsx` and imports the unchanged `apps/server/src/api/main.ts` / `workflow/main.ts`. Env: `DATABASE_URL`, `API_PORT` (stable, see below), `ALLOWED_ORIGINS` = the API origin, and `SPARK_API_TOKEN` (API only; the worker never sees it). F-24 migrate-at-startup runs as-is. Inherited `DATABASE_URL`, `SECRET_STORE` and similar are dropped, and `.local/credentials.env` is never loaded, so the shell cannot reach the web dev database.
- **Supervision:** a crashed API or worker restarts with backoff (0.5 s doubling to 30 s, reset after a minute up, give up after 5 quick crashes with a dialog showing its last output). An API exit before it first answers `/api/health` stops startup with that output instead of retrying (so a failing migration is not backed up and retried in a loop).
- **Window:** the API serves the built web app (`apps/web/dist`) on its own origin, so the renderer's relative `/api` calls, `EventSource` and WebSockets need no change and no runtime config. `contextIsolation`, `sandbox` on, `nodeIntegration` off; `session.webRequest.onBeforeSendHeaders` adds `X-Spark-Token` to requests for the API origin (http and ws) and strips any page-set copy elsewhere. Other links open in the browser; the window title keeps the channel name and the Dock shows the DEV badge.
- **Boot screen:** the main window opens at launch, before Postgres starts, with the local `boot.html` (from the built web app, loaded from disk, no API) in a transparent `WebContentsView` over the window. It uses the saved theme (`appearance.json`, written when the user picks a theme and handed to the page as `?theme=`; `system` follows `nativeTheme`), shows the Spark blob waking up (static with reduced motion) and one status line that follows the real steps: Waking up, Starting the database, Backing up before the update (only when a backup runs), Updating your data, Starting Spark. The window shows once the boot page has painted. The app loads underneath; when the web app reports its first real content (`sparkDesktop.rendered()`, or after 15 s), the boot page fades out (at least 3 s after showing, so the blob party gets a moment) and the view is removed. Startup failures keep their dialogs. The window also passes the saved theme to the preload (`--spark-theme=`), and `index.html` seeds `localStorage` from it before React mounts. `index.html` also paints a static app-shell skeleton until React renders, and marks `/island` transparent before its first frame.
- **Stable origin for settings:** the renderer's `localStorage` (last view, sidebar width, island state, theme and every other `spark-` key) belongs to the API origin, so the API port is kept per install in `api-port.json`: a random port in 30000–39999 (below macOS's 49152+ range for temporary ports, so nothing else is handed it by chance), reused while it is free. If it is taken at launch the app picks another one in that range and saves it. To carry settings across such a move, main snapshots the `spark-` keys into `web-storage.json` (0600) every 15 s and before quitting; when the origin differs from the snapshot's, the preload restores the snapshot into `localStorage` (sync IPC, once per launch, API-origin senders only) before any page script runs. The launch token is unchanged: still created per launch and never stored.
- **git:** `git --version` at startup; if it fails, a dialog explains `xcode-select --install` and the app keeps running.
- **Companion island (macOS):** "Show companion on desktop" is on by default (the old Calm mode flag in `companion.json` is ignored); `companion.json` in the data folder keeps any choice the user saved, and only missing values take the defaults. The island, tray menu and global shortcuts start after the host has wired its tray and IPC, so a first launch with the companion on is safe. The island opens only after the main window has finished booting, and its window stays hidden until the island page reports that the resting blob has drawn (`island.ready()`, or after 8 s); the blob fades in. The island window takes keyboard focus (focusable, focused, page focused) only while a panel or focused card needs keys, and gives it back when it closes. The notch-hugging shape is drawn only when the built-in display's menu bar is taller than 30 pt; otherwise the window still docks at the screen top, the blob hangs over the menu bar, and the island grows down from the top edge. At rest the window shrinks to a centred strip around the blobs. Running and finished work never expand the island; a chat that needs you drops a one-line pill only while the main window isn't focused (main sends `browser-window-focus`/`blur` to the island). While the island is open, Escape is a global shortcut that's released on collapse.
- **Browser pane:** one `WebContentsView` per chat tab on its own session partition, with Spark's ports blocked; the worker reaches it over the utility process port. See [BROWSER.md](BROWSER.md).
- **Quit** (window close, Cmd+Q, SIGINT/SIGTERM): worker and API get SIGTERM (SIGKILL after 10 s), then Postgres stops, then the app exits.

Verified on 2026-09-28 (Intel Mac, Electron 44.4.5 / Node 24.21): window loads onboarding; in-page `fetch('/api/health')` 200, `/api/setup` 200, `/api/events` stream opens; `window.require`/`process` undefined; direct `curl` without or with a wrong token gets 401; killing the worker with SIGKILL restarts it after 500 ms; quitting leaves no Electron, utility or Postgres processes. The terminal WebSocket through the injected header was not exercised live.

## Step 3: packaging and updates

`pnpm desktop:package` builds `apps/desktop/release/<version>/` (zip + dmg, x64 and arm64, plus `*-mac.yml`, blockmaps and `release-notes.html`). Details, signing and the release process are in [RELEASES.md](RELEASES.md).

- **Layout:** `Contents/Resources/app` holds the bundled main process and its runtime `node_modules` (embedded-postgres, pg, tsx, electron-updater); `Contents/Resources/server` is a `pnpm deploy --prod --cpu=<arch>` of `apps/server` (TypeScript sources, migrations, adapters with the codex patch, node-pty prebuilds, ripgrep); `Contents/Resources/web` is the built web app. `layout.ts` picks these paths when packaged and the checkout paths from source. The packaged app is always the prod channel; `SPARK_APP_DATA` relocates its data folder for local tests.
- **asar is off** so spawned binaries (Postgres, ripgrep, node-pty `spawn-helper`, adapters, esbuild for tsx) run as plain files without `app.asar.unpacked` path mapping; `embedded-postgres` derives its binary paths from its own location, which asarUnpack alone cannot fix.
- **Trimmed bundle:** staging (`scripts/prune.ts`, `scripts/prune-postgres.ts`) drops the bundled Claude and Codex CLI packages (`@anthropic-ai/claude-agent-sdk-darwin-*`, `@openai/codex*`), node-pty's other platforms, sources and tests, source maps, type declarations and READMEs in `node_modules`, esbuild's duplicate CLI binary, and Electron locales other than English. Postgres keeps `initdb` and `postgres`, the dylibs they and the kept modules link (walked with `otool -L`), PL/pgSQL, the snowball dictionaries and encoding conversions; staging runs both binaries with `--version` on the host arch. The x64 app went from 1.3 GB (509 MB dmg) to 482 MB (186 MB dmg).
- **User's agent CLIs:** every Claude, Codex and Z.ai run looks up the CLI (`which`, then the login shell) and passes it as `CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH` (`agents/acp/agent-cli.ts`). No CLI means a "not installed" error, never a fallback; API key verification checks for the CLI first and offers the same install terminal.
- **Agent adapters** start with `process.execPath`; inside Electron that is the helper binary, so their launch adds `ELECTRON_RUN_AS_NODE=1` (`scriptLaunch` in `agents/acp/agents.ts`). The adapter's own children inherit it, so an agent's shell command that starts an Electron app would run it as Node.
- **Migrations on update:** before the API starts, the shell compares pending migrations, backs up (pg_dump 17 if found, else a cold copy of the stopped data folder), keeps three `update-*` backups, migrates once in a utility process and records the version in `migrated-version.json`; on failure it restores the backup, skips that version for updates and offers previous-version instructions. The API and worker no longer get `BACKUP_DIR`.
- **Icons:** `scripts/icons.ts` renders the Scout into `build/icon.icns` (packaged app), `assets/icon.png` / `assets/icon-dev.png` (About panel; the dev app also sets it as its Dock icon) and `assets/trayTemplate*.png` (menu-bar template image). `channelIcons` picks the channel's files.
- **Updates:** prod only, electron-updater generic provider at the one feed URL in `app-update.yml`; Stable/Beta, checks at launch and every 4 h, background download (switchable), an update blob above Settings in the rail, install on quit or on click only when `GET /api/runs/active` is 0 (a click otherwise waits for the work to finish). `SPARK_UPDATE_PREVIEW` fakes an update in the dev app.

Verified on 2026-10-01 (Intel Mac, ad-hoc signed): the packaged x64 app starts its bundled Postgres, migrates a fresh database, starts the API and worker and shows onboarding; quitting stops everything. The bundled `claude-agent-acp` answers ACP `initialize` when started by the helper binary with `ELECTRON_RUN_AS_NODE=1`. The update and migration checks are listed in RELEASES.md.

### Left for later

- **Server as JS:** compile `apps/server` instead of registering `tsx` at runtime.
- **pg_dump:** not bundled; `embedded-postgres` ships only `initdb`, `pg_ctl` and `postgres` (the app keeps the last two). The update backup falls back to a cold copy; `Contents/Resources/postgres-tools/bin` is checked first if a matching pg_dump/pg_restore 17 is added later.
- **PATH for GUI launches:** an app started from Finder gets a minimal PATH; agents, git and the CLI lookup need the login shell's PATH. The lookup runs while Postgres starts; the Git check waits for it.
- **Repo lock file** in `.git/` naming channel and run (isolation section): not built; the server has no hook for it yet (`repoBusy` only checks runs in its own database). TODO.
- **Worktrees under the channel data folder:** branches are per channel now, but copies still live in `<repo>/.spark/worktrees/<runId>`.
- **Link scheme:** `spark-outpost-dev://` is named but not registered with the OS (no handler yet).
- Menu bar residency when the window closes, logs to `logs/` instead of stdout, import-a-copy from the installed app's database, a dev keychain service name for `pnpm dev`, a Developer ID certificate and update hosting ([RELEASES.md](RELEASES.md)).
