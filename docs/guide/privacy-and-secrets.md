---
title: Privacy and secrets
section: Stay in control
order: 320
summary: Where keys are stored, why to paste keys only in the app's key field, the warning when a message has a key in it, how Spark redacts secrets, .sparkignore, what leaves your computer, the anonymous heartbeat, and Full Disk Access.
---

You'll see where Spark Outpost keeps your keys, which files agents never read, and how to keep more files private. About 3 minutes.

## Where your keys live

API keys and tokens are stored in your Mac's Keychain, under **Spark Outpost**. That covers provider keys, the Jev key, and GitHub, Jira, Linear and MCP server tokens.

Spark's database keeps only a masked hint, such as the first few and last four characters. Keys are never written to its logs.

When you connect a provider with **Local CLI**, the sign-in stays in that CLI. Spark runs it but never reads or stores it.

### If macOS asks to let Spark use the keychain

The first time a new or updated Spark reads a key, macOS may ask whether Spark Outpost may use its item in your keychain. Click **Always Allow** so it doesn't ask again. Spark keeps working while the prompt is open: after 10 seconds it stops waiting, Settings › Providers shows a reminder, and a test message says it is waiting for the keychain instead of hanging.

## Paste keys only in the key field

1. Open **Settings → AI providers** and select the provider's tile.
2. Paste the key into the key field on the **API key** tab.
3. Select **Verify key**.

Never paste a key into a chat message. Chat text is sent to the agent's provider and saved with the chat.

### If you paste a key into a message

When a message you're about to send looks like it has a secret in it, Spark holds it and shows a note above the box: "Paste API keys in Settings → AI providers instead." It checks for:

- API keys and tokens, such as `sk-ant-…`, `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `xoxb-…` and JWTs;
- private key blocks;
- `KEY=value` lines with a secret-looking name and a long random value.

Choose what to do:

- **Remove it** (selected by default; press Enter): replaces each secret with `[removed]` so you can review the message and send it.
- **Send anyway**: sends the message as you wrote it.
- Press Escape to go back and edit the message yourself.

The note shows in a chat, on Home, and in Spark Island's **Quick chat** and **Ask**. If you send anyway, the audit log still stores the message with the secret redacted, but the provider and the saved chat get it as written.

## How Spark redacts secrets

Before Spark stores or shows agent output, it replaces anything that looks like a secret with `[redacted:…]`, for example `[redacted:api_key]`. This covers:

- agent replies in the chat, the audit log, and Spark tool results;
- everything sent to Jev, and error messages from providers;
- private keys, bearer tokens, GitHub and Slack tokens, cloud keys, passwords in URLs, and `KEY=value` lines with a secret-looking name.

Spark also masks the actual values found in your project's secret files, such as `.env`, if an agent's reply repeats them.

## Secret files

Agents can't read or write these files directly, and commands that touch them always ask you first:

- `.env` and `.env.*`, except `.env.example`;
- SSH keys such as `id_rsa` and `id_ed25519`, and `*.pem`, `*.key`, `*.p12`, `*.pfx`;
- `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credentials` files and `api-token`.

Ship also leaves these files out of commits. For the other files that always ask, such as agent instruction files and git hooks, see [Protected paths](approvals.md#protected-paths).

## .sparkignore

To keep more files away from agents, list them in a `.sparkignore` file at the root of the repo, one pattern per line. For the pattern rules, see [Keep files away from agents with .sparkignore](approvals.md#keep-files-away-from-agents-with-sparkignore).

Files that match are treated exactly like secret files:

- agents can't read or change them, and commands that touch them ask;
- they're left out of the **@** file picker;
- their contents are never sent to Jev when the Map labels areas.

## What leaves your computer

| Where it goes                         | What                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Your AI provider**                  | Your messages, and the files and command output the agent reads while it works.                              |
| **Jev**, if connected                 | Short, redacted facts to make a decision, such as your request. Diffs for checks. File contents for the Map. |
| **GitHub, Jira, Linear, MCP servers** | Only what you or an agent sends them, when they're connected.                                                |
| **Spark Outpost team**, Mac app only  | The anonymous heartbeat, unless you turn it off. See below.                                                  |

Jev never gets image attachments or your credentials, and the Map never sends it secret files or `.sparkignore` files. With Spark off, Jev isn't called. See [Jev, Spark's advisor](jev.md) and [What Jev reads](map-areas.md#what-jev-reads).

Your chats and settings stay in a database on your computer.

## Anonymous heartbeat

The Mac app tells the Spark Outpost team how many people use it and in which country. About 30 seconds after it starts, and then once a day while it runs, it sends:

- a random install ID, made once on your Mac and stored as a hash on our side;
- the app version, macOS or another OS, and Intel or Apple silicon;
- whether it's a Stable, Beta or Dev build.

Cloudflare, which receives it, adds the country. Spark never sends chats, code, file or project names, your name, keys or your IP address, and the IP address isn't stored. Spark in a browser sends nothing.

To turn it off, open **Settings → Help** and turn off **Send anonymous heartbeat**. While it's off, nothing is sent.

## Full Disk Access on Mac

On the Mac app, **Settings → Help → Full Disk Access** is an optional switch that stops macOS from asking every time an agent reads a protected folder, such as `~/Library`, Desktop, Documents or Downloads. It's also offered as a skippable step in setup.

macOS doesn't let apps turn this on themselves. The card's **Open System Settings** button opens **Privacy & Security → Full Disk Access**, where you switch on **Spark Outpost** yourself. Without it, macOS may still ask once per folder the first time an agent reads there, and you can allow those individually instead of granting Full Disk Access.

Full Disk Access only stops macOS's own file-access prompts. It doesn't replace Spark's own approvals before a command or edit runs; see [Approvals and protected paths](approvals.md).

## What Spark tools never return

Spark tools never give agents file contents, terminal output, secrets or API keys. If a run reads private data, Spark asks before anything in that run sends data out. See [Spark tools for agents](spark-tools.md#what-the-tools-never-return).

## Keep my API keys when you reset

**Settings → Reset** deletes your chats, projects and settings. To keep your provider keys:

1. Open **Settings → Reset**.
2. Turn on **Keep my API keys**. It's off by default. Claude, Codex, Z.ai and Jev keys then stay in your Keychain.
3. Press and hold **Hold to reset** for 1.5 seconds. You then have 10 seconds to select **Undo**.

GitHub, ticket and MCP tokens are always removed.

> **Tip:** To check what Spark stored, open the Keychain Access app and search for **Spark Outpost**.

**Next:** [Spark tools for agents](spark-tools.md)
