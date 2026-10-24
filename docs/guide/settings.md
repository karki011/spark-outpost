---
title: Settings
section: Reference
type: reference
order: 610
summary: Every Settings section by group, its rows and defaults, and the page that explains each one.
---

**Settings** is on the rail; **⌘,** opens its Mac window. **Search settings** finds a section or row; Enter opens it.

## General

| Section                   | Holds                                                                                                                             | More                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Profile & personality** | **What should Spark call you?** and **Personality** (**Friendly**).                                                               | [Set up](getting-started.md#meet-spark-and-pick-a-look) |
| **Voice**                 | Mac app: push to talk.                                                                                                            | [Voice](voice.md)                                       |
| **Appearance**            | **Automatic**, **Tint** (**Graphite**), **Increase contrast**. Terminals: [SF Mono](https://developer.apple.com/fonts/) or Menlo. | [Set up](getting-started.md#meet-spark-and-pick-a-look) |

### Spark assistant

**Spark assistant** sets [Ask Spark](companion-quick-chat.md#ask-spark)'s **Provider**, **Model** (**Fast (recommended)**: Sonnet 5.5), **Effort**, **When Ask Spark acts** (**Manual** or **Act**) and **Key facts**. **View conversation** opens its hidden chat, marking where each **New topic** began.

## Agents

| Section          | Holds                                                                | More                                                   |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------ |
| **AI providers** | Claude, Codex, Z.ai, and Jev under **Advisor**.                      | [Providers](providers-and-models.md)                   |
| **Models**       | Each model; open one for cost and benchmarks.                        | [Models](providers-and-models.md#read-the-model-cards) |
| **Crew**         | Named Sparks.                                                        | [Sparks](sparks.md)                                    |
| **Usage**        | Tokens and cost per reply, by provider; **~** marks Codex estimates. | [Jev](jev.md#what-it-costs)                            |

## Work

**Projects**: linked folders and **Add folder…**. Open one for trust, **Where Spark works**, **Saved sign-ins** and **Preview** ([Where it works](where-spark-works.md)).

**Chats & autonomy**:

| Row                                          | Default                | More                                                   |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| **How much Spark does alone**                | **Full auto → PR**     | [Autonomy](spark-autonomy.md)                          |
| **Wait before going on without your answer** | **60s**                | [Approvals](approvals.md#if-you-dont-answer)           |
| **Warn when context is**                     | 60%                    | [Compaction](compaction.md#change-when-spark-compacts) |
| **Compact automatically at**                 | 80%, on                | [Compaction](compaction.md#change-when-spark-compacts) |
| **While the agent is working, Enter**        | **Queues the message** | [Queue](follow-a-turn.md#queue-messages)               |
| **On wide windows**                          | **Context rail**       | Rail, panel or nothing                                 |
| **Archive inactive chats**                   | **After 2 days**       | [Chat list](statuses-and-limits.md#chat-list)          |
| **Record Terminal sessions like chats**      | Off                    | [Below](#record-terminal-sessions)                     |

**Custom instructions**: text or a UTF-8 file from your Mac, up to 16 KB; then **Save instructions**.

### Record Terminal sessions

When on, new Claude [Terminal](terminals.md) turns keep tool calls (input and output), replies, changed files and an audit, like a chat. Secret-file values are hidden.

Pushes to other branches, force pushes, protected files and writes outside the project are flagged, not stopped. Not for Codex.

**Pull requests**:

| Row                                              | Default              | More                                                        |
| ------------------------------------------------ | -------------------- | ----------------------------------------------------------- |
| **Open pull requests as**                        | **Ready for review** | [Ship](ship-and-pull-requests.md#ready-for-review-or-draft) |
| **Follow up on pull requests**, and its switches | On                   | [Follow-up](pr-follow-up.md#turn-it-off)                    |

**Spark rules**:

| Row                                         | Default           | More                                    |
| ------------------------------------------- | ----------------- | --------------------------------------- |
| Publishing, GitHub commands, Files, Sending | Recommended rules | [Rules](protected-paths.md#spark-rules) |
| **Allowed gh commands**                     | None              | [Rules](protected-paths.md#spark-rules) |

## Connections

| Section         | Holds                                                                                                 | More                             |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Connectors**  | GitHub, Atlassian, Linear, [Slack](connect-slack.md), Calendar (**Let agents read my calendar**: on). | [Connect](tickets-and-github.md) |
| **MCP servers** | Off until on for all chats, a project or one chat.                                                    | [Glossary](glossary.md)          |

## Mac

**Mac control** (Mac app): **Let agents control other Mac apps** and the Accessibility permission ([Mac control](mac-control.md)).

**Browser pane** (Mac app): signed-in sites, **Sign out of everything**, **Search engine**, **Clear browser history**.

**Notifications**:

| Row                                                                                                                                                                                                                     | Default                                                                         | More                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Morning brief**                                                                                                                                                                                                       | 7:00                                                                            | Daily summary on **Home**                               |
| **Status companion**                                                                                                                                                                                                    | **Show**                                                                        | [Island](desktop-companion.md#inside-the-app)           |
| Mac app: **Show Spark Island**, **Spark Island size**, **Show in menu bar**                                                                                                                                             | On, **Full**, off                                                               | [Island](desktop-companion.md)                          |
| **Dock badge and notifications**                                                                                                                                                                                        | On                                                                              | [Island](desktop-companion.md#when-spark-island-is-off) |
| **Open requests by themselves**, **Island chimes**                                                                                                                                                                      | On, off                                                                         | [Island](desktop-companion.md#answer-a-card)            |
| **Hide in screen sharing**                                                                                                                                                                                              | On                                                                              | [Island](desktop-companion.md#turn-it-on-and-size-it)   |
| **Quick chat shortcut**, **Inbox shortcut**                                                                                                                                                                             | ⌥Space, ⌥⇧Space                                                                 | [Shortcuts](companion-quick-chat.md#change-a-shortcut)  |
| Mac app: **Add today’s calendar to the brief**, **Meetings**, **Meeting alerts**, **Alert at**, **Join meetings automatically**, **Hold chimes during**, **Calendars that nudge**, **Meeting alerts on paired devices** | On, 10 min, **Center of the screen**, at start, off, **Focus blocks**, all, off | [Calendar](calendar.md)                                 |

## App

| Section     | Holds                                                                                                 | More                                           |
| ----------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Updates** | Mac app: version, **Channel**, **Download updates automatically**, **Check for updates**.             | [Updates](updates.md)                          |
| **Help**    | **Export diagnostics**, **Send feedback**. Mac app: **Logs folder**, heartbeat, **Full Disk Access**. | [Mac privacy](mac-privacy.md)                  |
| **Reset**   | Start over; **Keep my API keys**: off.                                                                | [Reset](trouble-setup-and-reset.md#start-over) |
