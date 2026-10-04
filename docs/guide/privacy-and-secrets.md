---
title: Privacy and secrets
section: Understand Spark
type: concept
order: 522
summary: Where your keys are stored, what leaves your computer and where it goes, and how Spark redacts secrets.
---

Your chats, settings and code stay on your computer, and keys live in your system keychain. Only what your AI provider, Jev and connected tools need leaves it.

## What leaves your computer

| Goes to                               | What                                                                                     | Stop it                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Your AI provider**                  | Your messages, and files, command output and allowed Slack messages the agent reads.     | Use [`.sparkignore`](sparkignore.md) for files                   |
| **Jev**, if connected                 | Short, redacted facts about a request. Diffs and short file previews. Map file contents. | See [what Jev reads](jev.md#what-jev-reads)                      |
| **GitHub, Jira, Linear, MCP servers** | Only what you or an agent sends them.                                                    | Disconnect them                                                  |
| **Slack**                             | Notifications, confirmed posts. Never direct message text.                               | [Slack data](connect-slack.md#what-spark-reads-stores-and-sends) |
| **Spark Outpost team**, Mac app only  | The anonymous heartbeat.                                                                 | [Turn it off](mac-privacy.md#anonymous-heartbeat)                |

Without Jev, nothing is sent to TypeSafe.

## Where your keys live

- API keys and tokens are in your Mac's Keychain, under **Spark Outpost**: provider and Jev keys, and connector and MCP tokens.
- Spark's database keeps a masked hint. Logs never hold keys.
- A **Local CLI** sign-in stays in that CLI. Spark never reads or stores it.

See [Keep keys out of chats](sparkignore.md#keep-keys-out-of-chats).

## How Spark redacts secrets

Before storing or showing agent output, Spark replaces anything secret-looking with `[redacted:…]`: keys, tokens, passwords in URLs, `KEY=value` lines and values from your secret files.

This covers agent replies, the audit log, Spark tool results, provider errors and anything sent to Jev.

## What agents can't reach

- [Secret files](protected-paths.md#secret-files) and anything in `.sparkignore`. Ship leaves them out of commits too.
- Through [Spark's own tools](spark-tools.md#what-the-tools-never-return): file contents, terminal output, secrets and keys.
- [Browser pane](use-the-browser.md): password and card fields. Cookies stay on this Mac.

After a run reads private data, Spark asks before it [sends data out](approvals.md#sending-data-out-after-reading-secrets).

## When you reset

**Settings → Reset** removes GitHub, ticket, Slack and MCP tokens. **Keep my API keys** keeps provider and Jev keys. See [Start over](trouble-setup-and-reset.md#start-over).
