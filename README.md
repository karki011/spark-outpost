<div align="center">

<img src="docs/design/logo/blob-scout-mark.svg" alt="Scout, Spark Outpost's teal blob with a spark" width="112" height="112">

# Spark Outpost

**A home base for autonomous work.**

Run Claude Code and Codex side by side on your Mac. Follow every step, answer the approvals that matter, and get pull requests back.

<!-- release-downloads:start -->

<a href="https://pub-aae3512121074a13b84ee166f8d153af.r2.dev/Spark-Outpost-latest-arm64.dmg"><img alt="Download for Mac, Apple silicon" src="https://img.shields.io/badge/Download_for_Mac-Apple_silicon-2bb39a?style=for-the-badge&logo=apple&logoColor=white"></a> <a href="https://pub-aae3512121074a13b84ee166f8d153af.r2.dev/Spark-Outpost-latest-x64.dmg"><img alt="Download for Mac, Intel" src="https://img.shields.io/badge/Download_for_Mac-Intel-555555?style=for-the-badge&logo=apple&logoColor=white"></a>

Free beta · [0.1.0-beta.5](releases/0.1.0-beta.5.md) · macOS 13+ (Mac control needs 14) · [All versions](releases/README.md)

<!-- release-downloads:end -->

<p>
<a href="apps/desktop/CHANGELOG.md"><img alt="Version 0.1.0-beta.5" src="https://img.shields.io/badge/version-0.1.0--beta.5-2bb39a"></a>
<img alt="macOS 13 or later" src="https://img.shields.io/badge/macOS-13%2B-111111?logo=apple&logoColor=white">
<img alt="Apple silicon and Intel" src="https://img.shields.io/badge/arch-arm64%20%7C%20x64-555555">
<img alt="Agent Client Protocol" src="https://img.shields.io/badge/protocol-ACP-6e56cf">
<a href="LICENSE"><img alt="FSL-1.1-MIT license" src="https://img.shields.io/badge/license-FSL--1.1--MIT-555555"></a>
</p>

<a href="https://spark-outpost.karki011.workers.dev">Website</a> · <a href="#features">Features</a> · <a href="#local-first-stated-honestly">Privacy</a> · <a href="docs/guide/getting-started.md">User guide</a> · <a href="#develop">Develop</a>

<br><br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/guide/images/terminals-dock-dark.png">
  <img alt="Spark Outpost: chats by project on the left, a new chat in acme-web with Full auto → PR, and a terminal docked below" src="docs/guide/images/terminals-dock-light.png" width="900">
</picture>

</div>

## Features

<table>
<tr>
<td width="50%" valign="top">

### Your agents, your modes

Claude Code and Codex with their own permission modes, shown with their own names, or a local model through any server that speaks the Anthropic Messages API, such as Ollama or LM Studio. Spark’s recommended rules guard secret files, git hooks and config, and publishing; with no rules, the agent’s mode decides. Each chat keeps its agent running between messages; its sub-agents appear as cards in the Work panel, and the agent can start sub-chats in an outpost when the work spans repos.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/guide/images/chats-and-modes-permissions-dark.png">
  <img alt="The agent picker with Claude's modes: Manual, Accept edits, Plan, Auto and Bypass permissions" src="docs/guide/images/chats-and-modes-permissions-light.png" width="100%">
</picture>

</td>
<td width="50%" valign="top">

### From chat to pull request

Each chat gets its own branch in a worktree. **Full auto → PR** opens the pull request, follows up on failing checks and review comments, and never merges.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/guide/images/pr-follow-up-card-dark.png">
  <img alt="The Address PR feedback card" src="docs/guide/images/pr-follow-up-card-light.png" width="300">
</picture>

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Make your own Spark

Give a teammate a name, a face and a role, with its own chat, default provider, model and mode, and standing instructions. Talk to it directly, or type `@` in any chat to hand it one job, which it does read-only. Approvals and protected paths never change. [Make a Spark](docs/guide/sparks.md)

</td>
<td width="50%" valign="top">

### Ask Spark and Spark Island

Scout rests at the top of your screen with what needs you: answer a request, see working chats, or ask Spark about any of them. It asks before acting unless you switch it to **Act**. [Use Spark Island](docs/guide/desktop-companion.md)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Browser pane with developer tools

Agents open pages in the chat's Browser pane, click and type there, and read the console, network log and page performance. One profile serves every chat, so agents are signed in where you are, and page content is treated as untrusted. Use **Select** to point an agent at elements on the page. [Use the browser](docs/guide/use-the-browser.md)

</td>
<td width="50%" valign="top">

### A browser of your own

The Browser view has Spaces, pinned folders, split view, Peek and a command bar. Its **Personal** profile is closed to every agent; a page reaches a chat only when you attach its text or hand over its address. [Browse on your own](docs/guide/browse-on-your-own.md)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Mac control and terminals

Let an agent read another Mac app and press its buttons and menus, after you allow it. Terminal sessions keep running across restarts, and terminals dock to each chat's worktree.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/guide/images/terminals-stop-dark.png">
  <img alt="A docked terminal tab with its Stop control" src="docs/guide/images/terminals-stop-light.png" width="100%">
</picture>

</td>
<td width="50%" valign="top">

### Voice

Push to talk, off until you turn it on. Dictate a message or speak a command; speech becomes text on your Mac, and nothing is sent until you confirm it. [Talk to Spark](docs/guide/voice.md)

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Calendar, with Scout on time

Google and Mac calendars beside your chats, with one-click Join. Before a meeting, Scout drops a card to the middle of the screen with Join, Snooze and Dismiss. [See your day](docs/guide/calendar.md)

</td>
<td width="50%" valign="top">

### Connect your tools

Connect GitHub, Jira and Confluence, ServiceNow, Linear, Slack and your calendars, or add your own MCP server. Start a chat from a ticket, let agents read and update your tools, and keep tickets in step with pull requests.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/guide/images/tickets-start-dark.png">
  <img alt="Start work on a Linear ticket: plan first or build, in a project folder" src="docs/guide/images/tickets-start-light.png" width="300">
</picture>

</td>
</tr>
<tr>
<td width="50%" valign="top">

### From your phone

Pair a phone or another computer over Tailscale (never Funnel) to follow chats, answer approvals you allow and get a push when a chat needs you. [Use your phone](docs/guide/use-your-phone.md)

</td>
<td width="50%" valign="top">

### Local-first, stated honestly

Chats, settings and code stay on your Mac, keys live in the keychain, and voice audio never leaves it. What a chat needs goes to the AI provider and the tools you connect, and the one anonymous daily heartbeat can be turned off. [Privacy and secrets](docs/guide/privacy-and-secrets.md)

</td>
</tr>
</table>

**Works with** Claude Code · Codex · Ollama and other local models · Gemini CLI, OpenCode and Amp in Terminal sessions · GitHub · Jira · Confluence · ServiceNow · Linear · Slack · Google Calendar · Mac Calendar · Tailscale

## Getting started

1. Download the dmg for your Mac above (the links always fetch the newest build), open it and drag **Spark Outpost** to **Applications**. The first start sets up a local database and takes up to a minute.
2. Connect a provider: the Claude Code CLI, the Codex CLI, an Anthropic, OpenAI or Z.ai API key, or a custom endpoint for a local model. Git is needed for code work.
3. Optionally connect GitHub, Atlassian, ServiceNow, Linear, Slack or a calendar.
4. Start a chat. Ask a question about a project, or link a repo and ask for a small change.

Requires macOS 13 or later (Mac control needs macOS 14) and about 2 GB of disk space. The app updates itself on the **Stable** or **Beta** channel, and never while an agent is working.

## Status and feedback

**Free beta.** Expect rough edges. There is no Windows or Linux build.

Spark Outpost doesn't take pull requests. You're welcome to [open an issue](https://github.com/karki011/spark-outpost/issues) or fork it for any non-competing use under the [Functional Source License](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md).

Found something? Open **Settings → Help → Send feedback** (or **Help → Send Feedback…**), turn on **Include diagnostics** for bugs, and send the draft. Diagnostics hold versions, settings and recent logs, never chats, prompts, file contents, keys or tokens. Nothing is sent without you.

The Mac app sends one anonymous heartbeat a day (a random install ID, the app version and OS; Cloudflare adds the country) so we know how many people use it. Turn it off in **Settings → Help → Send anonymous heartbeat**. See [Mac privacy](docs/guide/mac-privacy.md#anonymous-heartbeat).

## Develop

### Run from source

You need Node.js 24, pnpm 12 and PostgreSQL 17.

```bash
pnpm install
pnpm db:setup && pnpm db:up && pnpm db:migrate
pnpm dev            # API, worker and web app at http://127.0.0.1:5173
pnpm desktop:dev    # the Electron desktop app
pnpm check          # format, lint, typecheck, source rules, knip, unit tests
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for every command, the repo layout and testing. Working on a fork: read [AGENTS.md](AGENTS.md) first. Report security problems as [SECURITY.md](SECURITY.md) says. Releases, signing and the update feed are in [docs/architecture/RELEASES.md](docs/architecture/RELEASES.md); `pnpm release:downloads` regenerates the download section above and [releases/](releases/README.md).

### Docs

The user guide ships inside the app and lives in [`docs/guide`](docs/guide).

| Start here                                                     | Go deeper                                                |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| [Getting started](docs/guide/getting-started.md)               | [Agent mode](docs/guide/agent-mode.md)                   |
| [Spark at a glance](docs/guide/how-spark-works.md)             | [Spark autonomy](docs/guide/spark-autonomy.md)           |
| [Start a chat](docs/guide/start-a-chat.md)                     | [Protected paths](docs/guide/protected-paths.md)         |
| [Ship and pull requests](docs/guide/ship-and-pull-requests.md) | [Outposts](docs/guide/outposts.md)                       |
| [The desktop companion](docs/guide/desktop-companion.md)       | [Privacy and secrets](docs/guide/privacy-and-secrets.md) |
| [What's new](docs/guide/whats-new.md)                          | [Keyboard shortcuts](docs/guide/keyboard-shortcuts.md)   |

Architecture notes are in [`docs/architecture`](docs/architecture). The full docs index is [docs/README.md](docs/README.md).

### Built with

Electron · React and Vite · Express · PostgreSQL 17 (embedded in the desktop app) · TypeScript and Zod contracts · Agent Client Protocol · MCP · Vitest and Playwright

## License

Spark Outpost is source available under the [Functional Source License, Version 1.1, MIT Future License](LICENSE) (FSL-1.1-MIT). You may read, run, change and share it for any purpose except offering a product or service that competes with it. Two years after each release, that release becomes available under the MIT License.

<div align="center">
<sub>Made for people who want agents to do the work and still sleep at night.</sub>
</div>
