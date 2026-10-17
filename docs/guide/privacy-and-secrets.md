---
title: Privacy and secrets
section: Understand Spark
type: concept
order: 522
summary: Where your keys are stored, what leaves your computer and where it goes, and how Spark redacts secrets.
---

Your chats, settings and code stay on your computer; keys live in your keychain. Only what your AI provider, Jev and connected tools need leaves it.

## What leaves your computer

| Goes to                               | What                                                                                 | Stop it                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Your AI provider**                  | Your messages, and files, command output and allowed Slack messages the agent reads. | [`.sparkignore`](sparkignore.md) for files                       |
| **Jev**, if connected                 | Redacted PR comments, short turn facts, Map file contents.                           | See [what Jev reads](jev.md#what-jev-reads)                      |
| **GitHub, Jira, Linear, MCP servers** | What you or an agent sends; a clone talks to its host.                               | Disconnect them                                                  |
| **Sites agents open**                 | Addresses, typed text; never your sign-ins.                                          | [Agent mode](agent-mode.md)                                      |
| **Apple or Google push**              | Encrypted notifications; sender contact.                                             | **Notify this device**                                           |
| **Slack**                             | Notifications, confirmed posts; never direct messages.                               | [Slack data](connect-slack.md#what-spark-reads-stores-and-sends) |
| **Hugging Face**                      | The speech model, once.                                                              | [Voice](voice.md)                                                |
| **Meeting services, Google**          | The meeting you **Join**; calendar reads.                                            | [See your day](calendar.md)                                      |
| **Spark Outpost team**                | Anonymous heartbeat.                                                                 | [Turn it off](mac-privacy.md#anonymous-heartbeat)                |

## Where your keys live

- Keys and tokens are in your Keychain, under **Spark Outpost**: provider, Jev, connector and MCP keys, saved sign-ins.
- Logs never hold keys.
- A **Local CLI** sign-in stays in that CLI, unread by Spark.

See [Keep keys out of chats](sparkignore.md#keep-keys-out-of-chats).

## How Spark redacts secrets

In replies, audit logs, tool results, errors, Jev and [recorded Terminal sessions](settings.md#record-terminal-sessions), Spark replaces anything secret-looking with `[redacted:…]`: keys, tokens, URL passwords, `KEY=value` lines and secret-file values.

## What agents can't reach

- Anything in `.sparkignore`. Agents can read [secret files](protected-paths.md#secret-files), so your provider sees them. Ship commits neither.
- Through [Spark's own tools](spark-tools.md#what-the-tools-never-return): file contents, terminal output, secrets, keys.
- [Browser pane](use-the-browser.md): password and card fields, saved sign-ins. Cookies stay on this Mac.

After private reads, Spark notes [sends elsewhere](approvals.md#sending-data-out-after-reading-secrets).

## When you reset

**Settings → Reset** removes connector and MCP tokens and saved sign-ins. **Keep my API keys** keeps provider and Jev keys. See [Start over](trouble-setup-and-reset.md#start-over).
