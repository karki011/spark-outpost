# Releases and updates

How the desktop app is packaged, signed, published and updated. The installed app is the **prod** channel ([ELECTRON_PLAN.md](ELECTRON_PLAN.md)); the dev app run from a worktree never updates.

## What exists today

| Piece                            | Where                                                            | State                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Packaging                        | `pnpm desktop:package` (`apps/desktop/scripts/package.ts`)       | Works locally: zip + dmg for x64 and arm64, ad-hoc signed                                              |
| Update feed URL                  | `UPDATE_FEED_URL` in `apps/desktop/scripts/builder-config.ts`    | Empty until hosting is chosen; `SPARK_UPDATE_FEED_URL` overrides it per build                          |
| Updater                          | `apps/desktop/src/updater.ts`                                    | electron-updater, generic provider, prod only                                                          |
| Backup before migrating          | `apps/desktop/src/update-migration.ts`                           | pg_dump 17 when found, else a cold copy of the data folder; last 3 kept; restored if a migration fails |
| Settings › Updates + update blob | `apps/web/src/settings/UpdatesSection.tsx`, `app/UpdateBlob.tsx` | Desktop prod only; hidden in the browser and the dev app (preview with `SPARK_UPDATE_PREVIEW`)         |
| Local end-to-end check           | `pnpm desktop:e2e-update`                                        | Builds 0.0.1–0.0.3, serves a local feed, checks detect → download → stage and the migration guard      |
| CI template                      | [release-workflow.yml](release-workflow.yml)                     | Not active: it sits outside `.github/workflows`                                                        |

## One-time setup (the user)

1. **Developer ID certificate.** In the Apple Developer account, create a _Developer ID Application_ certificate and install it in the login keychain (`security find-identity -v -p codesigning` must list it). Builds then sign with it when `CSC_NAME="Developer ID Application: <Name> (<TEAMID>)"` is set; in CI use `CSC_LINK` (base64 .p12) and `CSC_KEY_PASSWORD`. Without either, builds are signed ad hoc and never notarized.
2. **Notarization credentials.** electron-builder reads, by name only: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, the safer option for CI). `~/.zshrc` already exports the first three; `APPLE_PASSWORD` there is not used. Notarization runs only when a Developer ID is configured and one complete set is present.
3. **Hosting.** Pick one place that serves static files over HTTPS and set `UPDATE_FEED_URL` once. Every file of a release goes to that one folder (see [Feed layout](#feed-layout)). The likely choice is a public GitHub repo `spark-outpost-releases`; GitHub Pages or a release named `feed` that is replaced each time both work with the generic provider. A plain `releases/latest/download` URL does not serve Beta, because `latest` skips prereleases.
4. **App icon.** Add `apps/desktop/build/icon.icns` (or `icon.icon`); builds use the Electron icon until then.
5. **First signed install is manual.** Ad-hoc builds cannot update to signed ones (Squirrel.Mac requires the new signature to satisfy the running app's designated requirement), so the first Developer ID build is installed from its dmg. Every later update is automatic.

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

1. **Version.** Bump `version` in `apps/desktop/package.json` (semver). Beta: `0.3.0-beta.1`, `0.3.0-beta.2`, … Stable: `0.3.0`.
2. **Changelog.** Add a section to `apps/desktop/CHANGELOG.md`.
3. **Checks.** `pnpm check`, `pnpm test:db`, `pnpm test:browser`. If the release adds migrations, read them for anything that cannot run inside a transaction and confirm the backup path with `pnpm desktop:e2e-update`.
4. **Build, sign, notarize.** With the certificate installed and the Apple variables set:
   ```sh
   CSC_NAME="Developer ID Application: <Name> (<TEAMID>)" pnpm desktop:package
   ```
   `--arch x64|arm64|current` builds one arch; the default builds both. `--version` overrides the package version.
5. **Verify the artifacts.**
   ```sh
   codesign --verify --deep --strict --verbose=2 "apps/desktop/release/<v>/mac-arm64/Spark Outpost.app"
   spctl -a -vv "apps/desktop/release/<v>/mac-arm64/Spark Outpost.app"
   xcrun stapler validate "apps/desktop/release/<v>/Spark-Outpost-<v>-arm64.dmg"
   ```
   Open the dmg on a machine (or user account) that has the previous version installed and confirm it starts and keeps the data.
6. **Upload.** Upload zips, blockmaps, dmgs and `release-notes.html` first, then the `*-mac.yml` files last, so no client sees a channel file that points at a missing zip.

### Beta → Stable

A version string is baked into the binary, so promotion is a rebuild: tag the commit the last beta was built from, set the version to `0.3.0`, build and upload. That writes `latest-mac.yml` (Stable users get it) and `beta-mac.yml` (Beta users move from `0.3.0-beta.n` to `0.3.0`).

### Rollback

Clients never downgrade (`allowDowngrade` is off, including when someone switches Beta → Stable), and migrations only go forward.

- **Stop the rollout:** put the previous `latest-mac.yml` / `beta-mac.yml` back on the feed. Machines that have not downloaded the bad version stay where they are.
- **Fix forward:** release a new patch version (`0.3.1`) built from the last good code, keeping every migration the bad version shipped (or adding a migration that undoes it), because updated machines already have that schema.
- **A migration that fails on a user's machine** is handled there: the app restores the pre-update backup, records the version in `skipped-update.json` so it is not downloaded again, and offers _Open previous version instructions_ (written to `previous-version-instructions.txt` in the data folder, with the dmg URL for the previous version on the feed).

## What the installed app does

- Checks 15 s after launch and every 4 hours on the chosen channel (Settings › Updates: Stable or Beta, saved in `updates.json` in the data folder). **Download updates automatically** is on by default; turned off, Spark only announces an update and downloads it when asked.
- When an update is staged (or, with automatic downloads off, found), a small Spark blob with a dot sits above Settings in the rail and hops now and then (never with reduced motion or the companion's Calm mode). Its tooltip reads "New update ready — click to get the latest" with the version. A toast appears once per version.
- Clicking the blob downloads the update if needed (the blob works, with a progress bar and percentage), then installs and restarts. If any run is queued, running or waiting (`GET /api/runs/active`), it says "Spark will update when your work finishes", waits, and rechecks every 15 s. Settings › Updates is the detailed view: version, **Get the update** / **Restart to update**, channel, automatic downloads, **Check now**, last checked, **Release notes**.
- Quitting installs a staged update only when no run is active; otherwise it just quits and the update installs on a later quit.
- Dev preview: `SPARK_UPDATE_PREVIEW=available` (or `ready`) `pnpm desktop:dev` fakes version `9.9.9-preview` in the dev app so the blob and Settings can be seen and screenshotted; it never installs anything.
- On the first launch of a new version with pending migrations, before the API starts: back up (pg_dump 17 if found next to the app in `postgres-tools/bin` or from Homebrew `postgresql@17`; otherwise stop Postgres and copy the data folder), keep the newest 3 `update-*` backups in `backups/`, run the migrations once in a utility process, and record the version in `migrated-version.json`. A failure restores the backup and stops with a dialog.

## Local testing

- `pnpm desktop:package --arch current` builds an ad-hoc signed app in `apps/desktop/release/<version>/`. Launch it with `SPARK_APP_DATA=/tmp/somewhere` so it does not touch `~/Library/Application Support/Spark Outpost`.
- `pnpm desktop:e2e-update` builds 0.0.1, 0.0.2 (with an extra migration) and 0.0.3 (with a failing one) for the current arch, serves 0.0.2 from a local feed and prints which checks were verified and which are blocked by signing. It uses its own updater cache name (`spark-outpost-e2e-updater`) and data folder under `apps/desktop/release/e2e/`.

Last run on an Intel Mac without a Developer ID (2026-10-01, x64, ad-hoc signed, zip only):

| Check                                                                                             | Result                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.0.1 launches, starts bundled Postgres, migrates a fresh database, serves the window             | verified                                                                                                                                                                         |
| Updater finds 0.0.2 on the generic feed and downloads it in the background                        | verified                                                                                                                                                                         |
| Update zip staged in the updater cache with `update-info.json` (sha512 checked)                   | verified (530 MB zip)                                                                                                                                                            |
| Install on quit hands the zip to Squirrel.Mac                                                     | **blocked by signing**: Squirrel reports the code signature "did not pass validation: code failed to satisfy specified code requirement"; the app quits normally and stays 0.0.1 |
| Differential download                                                                             | **not exercised**: the first update after an install has no cached `update.zip`, so electron-updater downloads in full                                                           |
| 0.0.2 backs up (pg_dump 17 from Homebrew on this machine) before its new migration, records 0.0.2 | verified                                                                                                                                                                         |
| 0.0.3 with a failing migration restores the backup, writes the instructions, skips 0.0.3          | verified                                                                                                                                                                         |
| 0.0.2 opens the restored data again; at most 3 update backups kept                                | verified                                                                                                                                                                         |

Also checked by hand: a 0.0.2 install pointed at a feed with 0.0.3 downloads it to the ready state; the blob states (available → downloading → ready → waiting → restarting), the toast and Settings › Updates are covered by `tests/browser/desktop-updates.spec.ts` with a fake updater (`SPARK_SHOTS_DIR=<dir>` saves a screenshot per state). The cold-copy backup path is covered by unit tests, not by the packaged run (this machine has pg_dump 17).

## Known gaps

- **pg_dump is not bundled.** `embedded-postgres` ships only `initdb`, `pg_ctl` and `postgres`, and there is no matching `pg_dump` from the same source. The app uses a pg_dump 17 it can find, else the cold copy (equally safe for update rollback, larger on disk). To bundle one later, place `pg_dump` and `pg_restore` 17 with their libraries in `Contents/Resources/postgres-tools/bin`; the app already looks there first.
- **The server runs as TypeScript through `tsx`** from `Contents/Resources/server`. Compiling it to JavaScript would speed up start.
- **asar is off.** Postgres, the agent adapters, ripgrep, node-pty's `spawn-helper` and esbuild are spawned as files, and `embedded-postgres` builds its binary paths from its own location, so the runtime ships as plain files (the server tree and Postgres are outside any archive). The signature still seals the whole bundle.
- **Agent adapters are bundled** (`claude-agent-acp`, the patched `codex-acp` and their native CLIs) and run on the app's own runtime with `ELECTRON_RUN_AS_NODE=1`, which their child processes inherit. Signing in to Claude or Codex still uses the user's CLI logins; a full agent turn inside the packaged app has not been exercised.
- **PATH for Finder launches**, the link scheme, menu-bar residency and the dev icon remain as listed in ELECTRON_PLAN.md.
