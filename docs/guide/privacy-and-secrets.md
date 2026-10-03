---
title: Privacy and secrets
section: Understand Spark
type: concept
order: 830
summary: Where your keys are stored, what leaves your computer and where it goes, and how Spark redacts secrets.
---

Your chats, settings and code stay on your computer. Keys live in your system keychain, and the only things that leave are what your AI provider, Jev and the tools you connect need to do their job.

## What leaves your computer

| Goes to                               | What                                                                                     | Stop it                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Your AI provider**                  | Your messages, and the files and command output the agent reads.                         | Use [`.sparkignore`](sparkignore.md) for files    |
| **Jev**, if connected                 | Short, redacted facts about a request. Diffs and short file previews. Map file contents. | See [what Jev reads](jev.md#what-jev-reads)       |
| **GitHub, Jira, Linear, MCP servers** | Only what you or an agent sends them.                                                    | Disconnect them                                   |
| **Spark Outpost team**, Mac app only  | The anonymous heartbeat.                                                                 | [Turn it off](mac-privacy.md#anonymous-heartbeat) |

Without Jev, nothing is sent to TypeSafe.

## Where your keys live

- API keys and tokens are in your Mac's Keychain, under **Spark Outpost**: provider keys, the Jev key, and GitHub, Jira, Linear and MCP tokens.
- Spark's database keeps only a masked hint. Keys are never written to logs.
- A **Local CLI** sign-in stays in that CLI. Spark never reads or stores it.

To add keys safely, see [Keep keys out of chats](protect-secrets.md).

## How Spark redacts secrets

Before Spark stores or shows agent output, it replaces anything that looks like a secret with `[redacted:…]`.

| Covered                                                          | Examples                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| Agent replies, the audit log, Spark tool results                 | Private keys, bearer tokens, GitHub and Slack tokens |
| Everything sent to Jev, and provider error messages              | Cloud keys, passwords in URLs, `KEY=value` lines     |
| Values from your project's secret files, if a reply repeats them | The contents of `.env`                               |

## What agents can't reach

- [Secret files](protected-paths.md#secret-files) and anything in `.sparkignore`. Ship leaves them out of commits too.
- Through [Spark's own tools](spark-tools.md#what-the-tools-never-return): file contents, terminal output, secrets and keys.

If a run reads private data, Spark asks before anything in that run [sends data out](approvals.md#sending-data-out-after-reading-secrets).

## When you reset

**Settings → Reset** deletes your chats, projects and settings. Turn on **Keep my API keys** to keep provider and Jev keys. GitHub, ticket and MCP tokens are always removed. See [Start over](trouble-setup-and-reset.md#start-over).
