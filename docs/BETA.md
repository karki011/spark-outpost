# Spark Outpost beta

Two parts: the checklist for cutting and sharing a beta build, and a welcome note to send testers. Details of signing, the feed and promotion are in [architecture/RELEASES.md](architecture/RELEASES.md).

## Checklist (you)

Blocker first: signing and notarization need a **Developer ID Application** certificate, and none is installed on this Mac yet. Until it is, `pnpm desktop:package --release` stops with "CSC_NAME is not set", and unsigned builds can't be handed to testers (Gatekeeper blocks them, and an unsigned build can't update itself).

1. **Certificate.** In your Apple Developer account, create a _Developer ID Application_ certificate and install it in the login keychain. `security find-identity -v -p codesigning` must list it.
2. **Feed and feedback address, once.** Create the R2 bucket, its public URL, a bucket-scoped API token and the `R2_*` variables ([Set up the R2 feed](architecture/RELEASES.md#set-up-the-r2-feed)). Put the public folder URL in `UPDATE_FEED_URL` (`apps/desktop/scripts/builder-config.ts`) and your feedback address in `FEEDBACK_EMAIL` or `FEEDBACK_REPO` (`apps/web/src/help/feedback-target.ts`), then commit.
3. **Version and notes.** `apps/desktop/package.json` is `0.1.0-beta.1`. Each new beta: bump to `-beta.2`, … and add a section to `apps/desktop/CHANGELOG.md`.
4. **Check.** `pnpm check`, `pnpm test:db`, `pnpm test:browser`.
5. **Build, sign and notarize** both architectures (the Apple variables in `~/.zshrc` are read by name):
   ```sh
   CSC_NAME="Developer ID Application: <Name> (<TEAMID>)" pnpm desktop:package --release
   ```
6. **Verify** one app per arch: `codesign --verify --deep --strict`, `spctl -a -vv`, `xcrun stapler validate` on each dmg ([commands](architecture/RELEASES.md#cutting-a-release)). Install the dmg on a second account and open it once.
7. **Upload.** `pnpm desktop:release` prints exactly what will go up, in order. Then `pnpm desktop:release --yes`.
8. **Share** the two dmg links, `<feed URL>/Spark-Outpost-<version>-arm64.dmg` (Apple silicon) and `…-x64.dmg` (Intel), with the welcome note below. Later betas reach testers on their own.
9. **Listen.** Feedback arrives at your address or repo, usually with a diagnostics zip attached. When a beta holds up, promote it ([Beta → Stable](architecture/RELEASES.md#beta--stable)).

What to tell testers: which dmg to pick (Apple menu → About This Mac: "Apple M…" means Apple silicon), that it is a beta that updates itself, what you want them to try, and how to send feedback (below).

## Welcome to the Spark Outpost beta

Thanks for trying Spark Outpost early. It's a desktop app that runs AI coding agents (Claude, Codex and others) on your own Mac, with your repositories, keys and chats staying on your machine.

### Install

1. You need macOS 13 or later and about 2 GB of free disk space.
2. Download the dmg for your Mac: **arm64** for Apple silicon (M1 and later), **x64** for Intel.
3. Open it and drag **Spark Outpost** to **Applications**, then open it from there.
4. The first start takes up to a minute while Spark sets up its local database.

### Before you start

You need one of these to talk to an agent:

- the Claude Code CLI (`claude`), installed and signed in (`claude auth login`), or
- the Codex CLI (`codex`), installed and signed in (`codex login`), or
- an API key from Anthropic, OpenAI or Z.ai.

For work on code you also need **Git** (`xcode-select --install` in Terminal if `git --version` doesn't answer). The setup steps check both and tell you what's missing.

### First steps

1. Follow the setup: your name, a theme, then **Connect your AI providers**, then **Bring in your tools** (GitHub, Jira or Linear are optional).
2. Start a chat. Ask a question about a project, or link a repository and ask for a small change.
3. Open **Docs** in the rail at any time; it has the full user guide.

### Send feedback

1. Open **Settings → Help** (or **Help → Send Feedback…** in the menu bar).
2. Write what happened and what you expected.
3. For anything that looks like a bug, turn on **Include diagnostics**. Spark saves a zip with versions, settings and recent logs; it never holds chats, prompts, file contents, keys or tokens.
4. Select **Open email draft** (or **Open GitHub issue draft**), attach the zip Spark points to, and send it. Nothing is sent without you.

### Known limitations

- It's a beta: expect rough edges. Updates arrive in the background and install when you quit, or with **Restart to update**, never while an agent is working. Settings → Updates shows your version with a **Beta** label.
- The app is large (about 530 MB) because it bundles its own database, server and agent adapters.
- If Spark can't find `claude`, `codex` or `git` although they work in Terminal, send feedback with diagnostics: apps opened from Finder get a shorter PATH than Terminal, and we want to hear where that bites.
- Slack isn't connected yet. Sign-in to Claude or Codex uses their own CLIs; Spark never stores those logins.
- There's no Windows or Linux build.
- Your data lives in `~/Library/Application Support/Spark Outpost`. Updates back it up before they change the database; please don't delete that folder to fix a problem, send diagnostics instead.
