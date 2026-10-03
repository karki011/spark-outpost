---
title: What's new
section: What's new
type: whats-new
order: 990
summary: Recent changes you can see in the app - what changed, who it affects, and what to do.
---

Newest first. Each entry says what changed, who's affected and what to do.

## October 2026: control

| What changed                                                                                              | Who's affected                                              | What to do                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **The plan card waits for Build at Automatic**, in every agent mode.                                      | Anyone at **Automatic**                                     | Select **Build**. For plans that build by themselves, use [**Full auto → PR**](spark-autonomy.md).                           |
| **Two autonomy levels**: **Automatic** and **Full auto → PR**.                                            | Everyone                                                    | Nothing. Chats on a retired level are now **Automatic**. To review each step, pick an [agent mode](agent-mode.md) that asks. |
| **Changes are kept without waiting for you.** The keep card shows "Kept automatically" with any concerns. | Everyone                                                    | Undo with [**Revert to before this run**](review-changes.md#keep-or-revert).                                                 |
| **Spark follows the agent's mode** and adds no command cards of its own.                                  | Everyone                                                    | Expect fewer cards. [Protected paths](protected-paths.md) still ask.                                                         |
| **Modes that never ask run wherever the chat works**; their actions are marked **ran without review**.    | **Bypass permissions**, **Approve for me**, **Full access** | Answer any [flag](approvals.md#actions-that-ran-without-review).                                                             |

## October 2026: chats

| What changed                                                  | Who's affected | What to do                                                             |
| ------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| **Cleaner chat**: plain step names and one live status line.  | Everyone       | [Follow a turn](follow-a-turn.md) from the line above the message box. |
| **Message queue** while a turn runs.                          | Everyone       | See [Queue messages](queue-messages.md).                               |
| **Delete a busy chat**: Spark stops its work first.           | Everyone       | **Delete** now works on running chats.                                 |
| **Agent TV for any chat**, with messages to one crew member.  | Everyone       | See [Watch and message the crew](agent-tv.md).                         |
| **Changes drawer** replaces inline diffs.                     | Everyone       | Press **⌘⇧D**. See [Review changes](review-changes.md).                |
| **Sparks**: named teammates with standing instructions.       | Everyone       | See [Make a Spark](sparks.md).                                         |
| **Secret warning** before a message with a key in it is sent. | Everyone       | See [Keep keys out of chats](protect-secrets.md).                      |

## October 2026: shipping and tickets

| What changed                                                                                                           | Who's affected        | What to do                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| **Pushes and PRs go through a route Spark controls**: your git login, a saved token, the GitHub connection, then `gh`. | Anyone who ships      | Hover the branch chip for the route. See [Ship a change](ship-and-pull-requests.md). |
| **Agents may open the PR themselves** when you ask, at Full auto, or in **Auto** or **Bypass permissions**.            | Anyone who ships      | Say "open a PR" in your message.                                                     |
| **Tickets inbox groups** by where each ticket is.                                                                      | Jira and Linear users | See [Work from the Tickets inbox](tickets-inbox.md).                                 |

## October 2026: Mac app and setup

| What changed                                                                               | Who's affected | What to do                                                             |
| ------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------- |
| **Spark Island states**: each chat's blob shows Working, Needs you, Done, Failed or Quiet. | Mac app        | See [Spark Island states](statuses-and-limits.md#spark-island-states). |
| **Spark Island Home and size.** It opens when you point at it.                             | Mac app        | See [Set up Spark Island](desktop-companion.md).                       |
| **New dock icon**: the Spark blob on a transparent background.                             | Mac app        | Nothing.                                                               |
| **Your own CLIs**: Spark runs the `claude` and `codex` you installed.                      | Everyone       | Install the CLI if a tile says **CLI not installed**.                  |
| **Anonymous heartbeat** and optional **Full Disk Access**.                                 | Mac app        | Review both in [Mac privacy settings](mac-privacy.md).                 |
| **The guide is reorganised** by task. Old links still work.                                | Everyone       | Start at [What do you want to do?](welcome.md)                         |
