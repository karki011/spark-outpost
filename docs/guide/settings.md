---
title: Settings
section: Reference
type: reference
order: 610
summary: Every Settings section by group, its rows and defaults, and the page that explains each one.
---

Select **Settings** at the bottom of the rail. **Search settings** finds a section or row: ↑, ↓ and Enter open it at that row, Esc clears. A row's book icon opens its guide page.

## General

| Section                   | Holds                                                                                                     | Read more                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Profile & personality** | **What should Spark call you?** and **Personality** (**Friendly**).                                       | [Set up](getting-started.md#meet-spark-and-pick-a-theme) |
| **Appearance**            | The theme, **Graphite** by default. Terminals use [SF Mono](https://developer.apple.com/fonts/) or Menlo. | [Set up](getting-started.md#meet-spark-and-pick-a-theme) |

## Agents

| Section          | Holds                                                                            | Read more                                                   |
| ---------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **AI providers** | Claude, Codex, Z.ai, and Jev under **Advisor**.                                  | [Manage providers](providers-and-models.md)                 |
| **Models**       | A row per model. Open one for cost and benchmarks.                               | [Model cards](providers-and-models.md#read-the-model-cards) |
| **Crew**         | Your named Sparks.                                                               | [Make a Spark](sparks.md)                                   |
| **Usage**        | Tokens and cost per reply, by provider. Codex costs are estimates, marked **~**. | [Jev's cost](jev.md#what-it-costs)                          |

## Work

**Projects**: linked folders. Open one for trust, **Where Spark works**, **Keep sign-ins in the browser**, **Saved sign-ins** and **Preview**. See [Where a chat works](where-spark-works.md).

**Chats & autonomy**:

| Row                                          | Default                | Read more                                                      |
| -------------------------------------------- | ---------------------- | -------------------------------------------------------------- |
| **How much Spark does alone**                | **Full auto → PR**     | [Spark autonomy](spark-autonomy.md)                            |
| **Wait before going on without your answer** | **60s**                | [If you don't answer](approvals.md#if-you-dont-answer)         |
| **Warn when context is**                     | 60%                    | [Manage a long chat](compaction.md#change-when-spark-compacts) |
| **Compact automatically at**                 | 80%, on                | [Manage a long chat](compaction.md#change-when-spark-compacts) |
| **While the agent is working, Enter**        | **Queues the message** | [Queue or send now](follow-a-turn.md#queue-messages)           |
| **On wide windows**                          | **Context rail**       | Rail, panel or nothing                                         |
| **Record Terminal sessions like chats**      | Off                    | [Record Terminal sessions](#record-terminal-sessions)          |

**Custom instructions** takes text or a UTF-8 file on your Mac, up to 16 KB; select **Save instructions**. New sessions send both and skip an unreadable file.

### Record Terminal sessions

With **Record Terminal sessions like chats** on, new Claude turns in a [Terminal session](terminals.md) keep tool calls with input and output, replies, changed files and an audit, like a chat. Secret-file values are hidden.

A push of another branch, a force push, a protected file or a write outside the project gets a flag; nothing is stopped. Codex sessions don't change.

**Pull requests**:

| Row                                              | Default              | Read more                                                            |
| ------------------------------------------------ | -------------------- | -------------------------------------------------------------------- |
| **Open pull requests as**                        | **Ready for review** | [Ship a change](ship-and-pull-requests.md#ready-for-review-or-draft) |
| **Follow up on pull requests**, and its switches | On                   | [PR feedback](pr-follow-up.md#turn-it-off)                           |

## Connections

| Section         | Holds                                                     | Read more                             |
| --------------- | --------------------------------------------------------- | ------------------------------------- |
| **Connectors**  | GitHub, Jira, Linear and [Slack](connect-slack.md).       | [Connect them](tickets-and-github.md) |
| **MCP servers** | Off until turned on for all chats, a project or one chat. | [Glossary](glossary.md)               |

## Mac

**Mac control** (Mac app): **Let agents control other Mac apps** and the Accessibility permission. See [Let agents use Mac apps](mac-control.md).

**Notifications**:

| Row                                                   | Default         | Read more                                                      |
| ----------------------------------------------------- | --------------- | -------------------------------------------------------------- |
| **Morning brief**                                     | 7:00            | A daily summary on **Home**                                    |
| **Status companion**                                  | **Show**        | [Spark Island](desktop-companion.md#inside-the-app)            |
| Mac app: **Show Spark Island**, **Spark Island size** | On, **Full**    | [Spark Island](desktop-companion.md)                           |
| **Dock badge and notifications**                      | On              | [Spark Island](desktop-companion.md#when-spark-island-is-off)  |
| **Open requests by themselves**, **Island chimes**    | On, off         | [Spark Island](desktop-companion.md#answer-a-card)             |
| **Quick chat shortcut**, **Sessions shortcut**        | ⌥Space, ⌥⇧Space | [Change a shortcut](companion-quick-chat.md#change-a-shortcut) |

## App

| Section     | Holds                                                                                                 | Read more                                           |
| ----------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Updates** | Mac app: the version, **Channel**, **Download updates automatically**, **Check for updates**.         | [Update the app](updates.md)                        |
| **Help**    | **Export diagnostics**, **Send feedback**. Mac app: **Logs folder**, heartbeat, **Full Disk Access**. | [Mac privacy settings](mac-privacy.md)              |
| **Reset**   | Start over. **Keep my API keys** is off by default.                                                   | [Start over](trouble-setup-and-reset.md#start-over) |
