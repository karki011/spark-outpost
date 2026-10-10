---
title: How Spark works
section: Understand Spark
type: concept
order: 510
summary: What Spark adds around Claude, Codex and Z.ai, and the path a message takes from the message box to a pull request.
---

One chat is one agent session: Claude Code, Codex or Z.ai. Your message goes to the agent as you typed it, and Spark moderates around it: approvals, a worktree, the audit and publishing.

## What happens to a message

| Step       | What happens                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Place   | In a mode that can change files, the chat gets its own [worktree](where-spark-works.md) and branch.                             |
| 2. Plan    | Only when you ask: `/plan` or **Plan** mode has the agent [plan first](plan-card.md).                                           |
| 3. Work    | The agent answers or changes code. Every action passes the [approval gate](approvals.md) and the audit.                         |
| 4. Keep    | Changed files are kept, with a **Changes kept** record you can [revert](review-changes.md).                                     |
| 5. Publish | You [ship](ship-and-pull-requests.md), or the agent pushes and opens the PR. Spark then [handles PR feedback](pr-follow-up.md). |

Spark adds nothing to the reply except a line about publishing.

## How work is split

The agent decides. Spark never splits a turn into roles.

| Work                                                | Who does it                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A small change                                      | The agent itself.                                                                    |
| Independent parts in one repo and branch            | The agent's own sub-agents. Their steps show as the agent's, gated and audited.      |
| Several repos, branches or pull requests            | Sub-chats in an [outpost](outpost-stories.md) that the agent proposes and you start. |
| A job for a [Spark](sparks.md) you mention with `@` | That Spark, in the same chat.                                                        |

## What Spark leaves to the agent

Spark runs no tests, picks no model and reviews no diff. The agent runs your project's checks; your repository's hooks and CI run on a push. For a second opinion, ask another chat.

Open the chat's **…** menu and select **Agent TV** to [watch the agent](follow-a-turn.md#see-whats-happening). Chats from before this change still show their crew, read-only.
