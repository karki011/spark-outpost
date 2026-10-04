# Releases and updates

How the desktop app is packaged, signed, published and updated. The installed app is the **prod** channel ([ELECTRON_PLAN.md](ELECTRON_PLAN.md)); the dev app run from a worktree never updates.

## What exists today

| Piece                            | Where                                                                                 | State                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packaging                        | `pnpm desktop:package` (`apps/desktop/scripts/package.ts`)                            | Zip + dmg for x64 and arm64; ad-hoc signed, or with a Developer ID the app and each dmg are signed, notarized and stapled (`scripts/notarize-dmg.ts`)                                                                                                                                     |
| Update feed URL                  | `UPDATE_FEED_URL` in `apps/desktop/scripts/builder-config.ts`                         | Empty until the R2 bucket exists; `SPARK_UPDATE_FEED_URL` overrides it per build                                                                                                                                                                                                          |
| Install heartbeat URL            | `HEARTBEAT_URL` in `apps/desktop/scripts/builder-config.ts`                           | Empty: builds send nothing. `SPARK_HEARTBEAT_URL` (the worker's `/v1/heartbeat` URL, https) overrides it per build and lands in the packaged `package.json` as `heartbeatUrl`; see [infra/heartbeat-worker](../../infra/heartbeat-worker/README.md)                                       |
| GitHub App client ID and slug    | `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_SLUG` in `apps/desktop/scripts/builder-config.ts` | Set to the Spark Outpost GitHub App (`spark-outpost`). `SPARK_GITHUB_APP_CLIENT_ID` and `SPARK_GITHUB_APP_SLUG` override them per build and land in the packaged `package.json` as `githubApp`; see [GITHUB_APP.md](GITHUB_APP.md). Both are public; never a client secret or private key |
| Release build check              | `pnpm desktop:package --release`                                                      | Fails with a clear message without `CSC_NAME`, notary variables, a feed URL or both archs                                                                                                                                                                                                 |
| Publish                          | `pnpm desktop:release` (`apps/desktop/scripts/release.ts`)                            | Dry run by default; `--yes` uploads to Cloudflare R2 with rclone, artifacts first, channel files last                                                                                                                                                                                     |
| Logs                             | `apps/desktop/src/file-log.ts`                                                        | Main, API and worker output in `<data>/logs/spark-outpost*.log`, redacted, 2 MB × 4 files                                                                                                                                                                                                 |
| Diagnostics and feedback         | `GET /api/diagnostics/export`, Settings › Help, Help menu                             | Zip of versions, providers, settings, migrations and logs; feedback opens a draft the user sends                                                                                                                                                                                          |
| Updater                          | `apps/desktop/src/updater.ts`                                                         | electron-updater, generic provider, prod only                                                                                                                                                                                                                                             |
| Backup before migrating          | `apps/desktop/src/update-migration.ts`                                                | pg_dump 17 when found, else a cold copy of the data folder; last 3 kept; restored if a migration fails                                                                                                                                                                                    |
| Settings › Updates + update blob | `apps/web/src/settings/UpdatesSection.tsx`, `app/UpdateBlob.tsx`                      | Desktop prod only; hidden in the browser; the dev app previews it with `SPARK_UPDATE_PREVIEW=flow`                                                                                                                                                                                        |
| Local end-to-end check           | `pnpm desktop:e2e-update`                                                             | Builds 0.0.1–0.0.3, serves a local feed, checks detect → download → stage and the migration guard                                                                                                                                                                                         |
| CI template                      | [release-workflow.yml](release-workflow.yml)                                          | Not active: it sits outside `.github/workflows`                                                                                                                                                                                                                                           |

## One-time setup (the user)

1. **Developer ID certificate.** In the Apple Developer account, create a _Developer ID Application_ certificate and install it in the login keychain (`security find-identity -v -p codesigning` must list it). Builds then sign with it when `CSC_NAME="Developer ID Application: <Name> (<TEAMID>)"` is set; in CI use `CSC_LINK` (base64 .p12) and `CSC_KEY_PASSWORD`. Without either, builds are signed ad hoc and never notarized.
2. **Notarization credentials.** electron-builder reads, by name only: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, the safer option for CI). `~/.zshrc` already exports the first three; `APPLE_PASSWORD` there is not used. Notarization runs only when a Developer ID is configured and one complete set is present.
3. **Hosting: a Cloudflare R2 bucket.** See [Set up the R2 feed](#set-up-the-r2-feed). Every file of a release goes to one folder (see [Feed layout](#feed-layout)).
4. **App icon.** Already in place: `pnpm --filter @spark-outpost/desktop icons` regenerates `build/icon.icns` (all sizes 16–1024 with @2x), `assets/icon.png`, `assets/icon-dev.png` (DEV corner badge, used for the dev app's Dock icon and About panel) and the menu-bar `assets/trayTemplate.png` / `@2x` from the Scout shape in `apps/web/src/brand/scout-shape.ts`. Rerun it after changing the logo and commit the output.
5. **First signed install is manual.** Ad-hoc builds cannot update to signed ones (Squirrel.Mac requires the new signature to satisfy the running app's designated requirement), so the first Developer ID build is installed from its dmg. Every later update is automatic.

## Set up the R2 feed

R2 serves the generic electron-updater feed with no egress fees, and its free tier (10 GB-month of storage, 1 million writes and 10 million reads a month) covers a small beta. The user does these steps once, in the Cloudflare dashboard; nothing in the repo creates accounts or buckets.

1. **Create the bucket.** Cloudflare dashboard → **R2 Object Storage** → **Create bucket**. Name it, for example, `spark-outpost-releases`; location Automatic; Standard storage class.
2. **Make it readable.** Open the bucket → **Settings** → **Public access**:
   - With a domain on Cloudflare: **Custom Domains** → **Connect Domain** → for example `updates.example.com`. Preferred: it is cached by Cloudflare and has no rate limit.
   - Without one: **R2.dev subdomain** → **Allow Access**. It gives `https://pub-<id>.r2.dev`. Cloudflare rate-limits r2.dev and describes it as not for production, which is fine for a few testers.
3. **Create an API token scoped to the bucket.** R2 Object Storage → **Manage API tokens** → **Create API token** (an Account API token): permission **Object Read & Write**, **Apply to specific buckets only** → the bucket, and a TTL if wanted. Copy the **Access Key ID** and **Secret Access Key** (shown once) and note the account ID in the S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. **Set the variables** where the shell loads them (for example the `# App developer` block in `~/.zshrc`, next to the Apple ones). Never commit them; the publish script only names them and passes them to rclone through its environment:
   ```sh
   export R2_ACCOUNT_ID=...            # or R2_ENDPOINT=https://... for another S3-compatible store
   export R2_ACCESS_KEY_ID=...
   export R2_SECRET_ACCESS_KEY=...
   export R2_BUCKET=spark-outpost-releases
   export R2_PREFIX=mac                # optional folder inside the bucket
   ```
5. **Install rclone:** `brew install rclone`. No `rclone config` is needed.
6. **Set the feed URL** to the public URL of that folder, for example `https://updates.example.com/mac` (or `https://pub-<id>.r2.dev/mac`): put it in `UPDATE_FEED_URL` in `apps/desktop/scripts/builder-config.ts` and commit it (it is public), or export `SPARK_UPDATE_FEED_URL` for each build. The URL is baked into each build's `app-update.yml`, so set it before the first build you hand out.
7. **Set the feedback address**: `FEEDBACK_EMAIL` (or `FEEDBACK_REPO`, `owner/repo`, for prefilled GitHub issues) in `apps/web/src/help/feedback-target.ts`, or `VITE_SPARK_FEEDBACK_EMAIL` / `VITE_SPARK_FEEDBACK_REPO` when building. With neither, **Send feedback** copies the report instead.

### What R2 costs

A release is about 800 MB: per arch, a 200 MB zip, a dmg of about the same size and a small blockmap. Storage is the only cost that grows; writes, update checks and downloads stay inside the free tier for a small beta, and egress is free.

| Releases kept on the feed (N) | Storage | Billed beyond 10 GB at $0.015/GB-month |
| ----------------------------- | ------- | -------------------------------------- |
| 3                             | 2.4 GB  | $0.00                                  |
| 5                             | 4 GB    | $0.00                                  |
| 10                            | 8 GB    | $0.00                                  |
| 20                            | 16 GB   | about $0.09 a month                    |

In general: about max(0, 2.14 × N − 10) × $0.015 a month. Deleting the dmgs of old releases halves it; keep old zips' blockmaps for differential downloads. Prices as of 2026; check Cloudflare's R2 pricing page.

## Feed layout

One folder, one URL. electron-builder writes these per build into `apps/desktop/release/<version>/`:

```
latest-mac.yml            Stable channel (written only by stable versions)
beta-mac.yml              Beta channel (written by stable and beta versions)
alpha-mac.yml             unused
Spark-Outpost-<v>-x64.zip, Spark-Outpost-<v>-arm64.zip        what the updater downloads
Spark-Outpost-<v>-x64.zip.blockmap, ...-arm64.zip.blockmap    for differential downloads
Spark-Outpost-<v>-x64.dmg, Spark-Outpost-<v>-arm64.dmg        first installs and manual reinstalls
release-notes.html        rendered from apps/desktop/CHANGELOG.md; linked from Settings › Updates
```

`generateUpdatesFilesForAllChannels` makes a stable release also update `beta-mac.yml`, so Beta users get stable releases too. Keep old zips' blockmaps on the feed: electron-updater compares the old and new blockmap to download only changed blocks. The first update after a fresh install always downloads in full (there is no cached `update.zip` yet).

## Cutting a release

1. **Version.** Bump `version` in `apps/desktop/package.json` (semver). Beta: `0.1.0-beta.1`, `0.1.0-beta.2`, … Stable: `0.1.0`. A version with a `-beta.n` suffix writes only `beta-mac.yml`, shows **Beta** in About and Settings, and starts new installs on the Beta channel; other prerelease tags are refused by the publish script.
2. **Changelog.** Add a section to `apps/desktop/CHANGELOG.md`.
3. **Checks.** `pnpm check`, `pnpm test:db`, `pnpm test:browser`. If the release adds migrations, read them for anything that cannot run inside a transaction and confirm the backup path with `pnpm desktop:e2e-update`.
4. **Build, sign, notarize.** With the certificate installed and the Apple variables set:
   ```sh
   CSC_NAME="Developer ID Application: <Name> (<TEAMID>)" pnpm desktop:package --release
   ```
   `--release` stops before building, with one line per problem, when `CSC_NAME` (or `CSC_LINK`) is missing, the notarization variables are incomplete, no feed URL is set, or `--arch` would build only one architecture. Without `--release`, builds stay unsigned (ad hoc) for local testing. `--arch x64|arm64|current` builds one arch; the default builds both in one run, which matters: electron-builder merges both zips into one `beta-mac.yml` / `latest-mac.yml`, and electron-updater's MacUpdater picks the file whose name contains `arm64` on Apple silicon (including under Rosetta) and the other one on Intel. Two separate runs would overwrite each other's channel file. `--version` overrides the package version.
5. **Verify the artifacts.**
   ```sh
   codesign --verify --deep --strict --verbose=2 "apps/desktop/release/<v>/mac-arm64/Spark Outpost.app"
   spctl -a -vv "apps/desktop/release/<v>/mac-arm64/Spark Outpost.app"
   xcrun stapler validate "apps/desktop/release/<v>/Spark-Outpost-<v>-arm64.dmg"
   ```
   Open the dmg on a machine (or user account) that has the previous version installed and confirm it starts and keeps the data.
6. **Upload.**
   ```sh
   pnpm desktop:release            # dry run: prints every file, its size and the order; uploads nothing
   pnpm desktop:release --yes      # uploads
   ```
   The script reads `apps/desktop/release/<version>/` (`--version` picks another), checks that the channel files are for this version and list both arch zips, and uploads zips, blockmaps, dmgs and `release-notes.html` first and the `*-mac.yml` files last, so no client sees a channel file that points at a missing zip. Artifacts are uploaded with a one-year immutable `Cache-Control`; channel files and the release notes with `no-cache`. If an upload fails, it stops before the channel files.

### Beta → Stable

A version string is baked into the binary, so a `-beta.n` build is never served to Stable. Two ways to promote:

- **Rebuild.** Tag the commit the last beta was built from, set the version to `0.1.0`, build with `--release` and run `pnpm desktop:release --yes`. A stable version writes `beta-mac.yml` (Beta users move from `0.1.0-beta.n` to `0.1.0`) and then `latest-mac.yml` (Stable users get it).
- **Soak, then promote the same binary.** Build `0.1.0` and run `pnpm desktop:release --beta-only --yes`: only Beta users get it. When it holds up, `pnpm desktop:release --promote --yes` uploads just `latest-mac.yml`, after checking that both `0.1.0` zips are already on the feed.

`--promote` on a beta version is refused with the rebuild instructions.

### Rollback

Clients never downgrade (`allowDowngrade` is off, including when someone switches Beta → Stable), and migrations only go forward.

- **Stop the rollout:** put the previous `latest-mac.yml` / `beta-mac.yml` back on the feed. Machines that have not downloaded the bad version stay where they are.
- **Fix forward:** release a new patch version (`0.3.1`) built from the last good code, keeping every migration the bad version shipped (or adding a migration that undoes it), because updated machines already have that schema.
- **A migration that fails on a user's machine** is handled there: the app restores the pre-update backup, records the version in `skipped-update.json` so it is not downloaded again, and offers _Open previous version instructions_ (written to `previous-version-instructions.txt` in the data folder, with the dmg URL for the previous version on the feed).

## What the installed app does

- Checks 15 s after launch and every 4 hours on the chosen channel (Settings › Updates: Stable or Beta, saved in `updates.json` in the data folder). **Download updates automatically** is on by default; turned off, Spark only announces an update and downloads it when asked.
- The app version sits under Settings at the bottom of the rail (`v0.1.0-beta.1`, plus `· dev` in the dev app, plus the download percentage while downloading); it opens Settings › Updates and hides below 640 px window height and in the browser build (`apps/web/src/app/RailVersion.tsx`).
- With automatic downloads off, a found update shows a **gray** Spark blob above Settings ("Update ready to download · click to get it"). Clicking it downloads, and the blob fills from gray to full colour bottom to top like a liquid (an SVG mask on `BlobScout`, `fill` prop) while it looks excited, with the percentage in the tooltip and next to the rail version. A staged update shows the blob in full colour with a dot ("Restart to update"); it hops now and then (never with reduced motion or the companion's Calm mode). A toast appears once per version. With reduced motion nothing hops or waves and the fill steps in 25 % increments.
- Clicking the coloured blob installs and restarts (the blob says "Installing…" and squashes). If any run is queued, running or waiting (`GET /api/runs/active`), it says "Spark will update when your work finishes", waits, and rechecks every 15 s. Settings › Updates is the detailed view: version, **Get the update** / **Restart to update**, channel, automatic downloads, **Check now**, last checked, **Release notes**.
- Quitting installs a staged update only when no run is active; otherwise it just quits and the update installs on a later quit.
- Dev preview (`apps/desktop/src/update-preview.ts`), dev app only, with the same controller, status and blob as the real flow:
  - `SPARK_UPDATE_PREVIEW=flow pnpm desktop:dev` (or **Preview the update flow** in Settings › Updates, shown only in dev builds): after 3 s the next version (`0.1.0-beta.1` → `0.1.0-beta.2`) is available; a click downloads it over about 8 s with uneven progress; Restart waits for running work exactly like the real flow, then after 1.5 s of "Installing…" writes `update-preview.json` to the data folder and calls `app.relaunch()` and a normal shutdown. The relaunched app reads and deletes the marker, skips the preview even if the variable is still set, and shows "Updated to <version> (preview)" once with a celebrating blob. Nothing is installed, preferences are not saved, and the version and data stay the same.
  - `SPARK_UPDATE_PREVIEW=flow-busy` pretends work is running at the first install attempt, so the "Spark will update when your work finishes" step shows; the 15 s recheck then uses real running work.
  - `available` and `ready` still jump straight to those states (`ready` downloads by itself).
- On the first launch of a new version with pending migrations, before the API starts: back up (pg_dump 17 if found next to the app in `postgres-tools/bin` or from Homebrew `postgresql@17`; otherwise stop Postgres and copy the data folder), keep the newest 3 `update-*` backups in `backups/`, run the migrations once in a utility process, and record the version in `migrated-version.json`. A failure restores the backup and stops with a dialog.

## Local testing

- `pnpm desktop:package --arch current` builds an ad-hoc signed app in `apps/desktop/release/<version>/`. Set `SPARK_UPDATE_FEED_URL` to any URL to also get the channel files, so `pnpm desktop:release` can show a dry run. Launch it with `SPARK_APP_DATA=/tmp/somewhere` so it does not touch `~/Library/Application Support/Spark Outpost`.
- `pnpm desktop:e2e-update` builds 0.0.1, 0.0.2 (with an extra migration) and 0.0.3 (with a failing one) for the current arch, serves 0.0.2 from a local feed and prints which checks were verified and which are blocked by signing. It uses its own updater cache name (`spark-outpost-e2e-updater`) and data folder under `apps/desktop/release/e2e/`.

Last run on an Intel Mac without a Developer ID (2026-10-01, x64, ad-hoc signed, zip only):

| Check                                                                                             | Result                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0.1 launches, starts bundled Postgres, migrates a fresh database, serves the window             | verified                                                                                                                                                                         |
| Updater finds 0.0.2 on the generic feed and downloads it in the background                        | verified                                                                                                                                                                         |
| Update zip staged in the updater cache with `update-info.json` (sha512 checked)                   | verified (530 MB zip, before the bundle was trimmed)                                                                                                                             |
| Install on quit hands the zip to Squirrel.Mac                                                     | **blocked by signing**: Squirrel reports the code signature "did not pass validation: code failed to satisfy specified code requirement"; the app quits normally and stays 0.0.1 |
| Differential download                                                                             | **not exercised**: the first update after an install has no cached `update.zip`, so electron-updater downloads in full                                                           |
| 0.0.2 backs up (pg_dump 17 from Homebrew on this machine) before its new migration, records 0.0.2 | verified                                                                                                                                                                         |
| 0.0.3 with a failing migration restores the backup, writes the instructions, skips 0.0.3          | verified                                                                                                                                                                         |
| 0.0.2 opens the restored data again; at most 3 update backups kept                                | verified                                                                                                                                                                         |

Also checked by hand: a 0.0.2 install pointed at a feed with 0.0.3 downloads it to the ready state; the blob states (gray → filling → coloured → waiting → installing → celebrating after a preview relaunch), reduced motion, the rail version, the toasts and Settings › Updates are covered by `tests/browser/desktop-updates.spec.ts` with a fake updater (`tests/browser/fake-updater.ts`; `SPARK_SHOTS_DIR=<dir>` saves a screenshot per state). The preview timings use fake timers in `apps/desktop/src/update-preview.test.ts`. The cold-copy backup path is covered by unit tests, not by the packaged run (this machine has pg_dump 17).

## Known gaps

- **pg_dump is not bundled.** `embedded-postgres` ships only `initdb`, `pg_ctl` and `postgres`, and there is no matching `pg_dump` from the same source. The app uses a pg_dump 17 it can find, else the cold copy (equally safe for update rollback, larger on disk). To bundle one later, place `pg_dump` and `pg_restore` 17 with their libraries in `Contents/Resources/postgres-tools/bin`; the app already looks there first.
- **The server runs as TypeScript through `tsx`** from `Contents/Resources/server`. Compiling it to JavaScript would speed up start.
- **asar is off.** Postgres, the agent adapters, ripgrep, node-pty's `spawn-helper` and esbuild are spawned as files, and `embedded-postgres` builds its binary paths from its own location, so the runtime ships as plain files (the server tree and Postgres are outside any archive). The signature still seals the whole bundle.
- **Agent adapters are bundled, the CLIs are not.** `claude-agent-acp` and the patched `codex-acp` run on the app's own runtime with `ELECTRON_RUN_AS_NODE=1`, which their child processes inherit; they run the user's installed `claude` and `codex` (found with the login-shell lookup, passed as `CLAUDE_CODE_EXECUTABLE` and `CODEX_PATH`). The adapters are pinned against a CLI version (Claude Code 2.1.280, Codex 0.156.1); a much older user CLI may lack options they send. A full agent turn inside the packaged app has not been exercised.
- **Trimmed bundle needs a signed check.** Postgres, node-pty and the adapters were smoke-tested from an ad-hoc signed x64 app (initdb, start, all migrations, PL/pgSQL, conversions and text search; a node-pty spawn; CLI lookup). Still to confirm with a Developer ID build: notarization of the trimmed tree, a first launch from the dmg on another Mac, and the arm64 build (its Postgres is only checked when staged on Apple silicon).
- **Keychain access prompts.** The server reads keys with `@napi-rs/keyring`'s async entries, so a macOS "allow access" prompt holds one libuv thread (calls are serialized), never the event loop; callers stop waiting after 10 s with `KeychainWaitingError` and `/api/providers/health` reports `keychainWaiting`. Reads are cached in memory and refreshed after a minute, serving the last value while a refresh waits. Who macOS trusts is not something the app can set: keyring creates items with the default access list, which trusts the creating binary through its code signature (the login keychain's partition list). Packaged releases are signed with "Developer ID Application: Subash Karki (Z825V2BBX9)", so items record `teamid:Z825V2BBX9` and stay trusted across updates: macOS asks once on first use, and after Always Allow every later release signed by the same team reads without asking. Only ad-hoc local builds (`pnpm desktop:package` without `CSC_NAME`) record the binary's cdhash, which changes with each build, so each one asks again; dev runs read as the Node binary and ask again after a Node upgrade.
- **PATH for Finder launches**, the link scheme, menu-bar residency and the dev icon remain as listed in ELECTRON_PLAN.md.
