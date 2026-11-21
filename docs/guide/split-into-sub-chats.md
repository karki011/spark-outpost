---
title: Split a job
section: Chats
type: how-to
order: 238
summary: Ask the agent to split a job into sub-chats, answer its plan card, and see what each piece starts with.
---

One chat's agent splits a job into [sub-chats](sub-chats.md), each with its own worktree, branch and pull request. About 2 minutes.

1. In a chat with a project, ask the agent: "split this into sub-chats".
2. In **Auto**, **Bypass permissions**, **Auto review** or **Full access** it starts them at once. In **Accept edits** it does when your message asked. Otherwise answer its **Start N sub-chats?** card.
3. Read each row: title, project, **New branch**, **Stacked on 1** or **Starts after 1, 2**, agent, model and effort. **Show each task ›** adds the tasks.
4. Select **Edit** to pick a piece's model and effort.
5. Select **Start**, or **Discard** to create nothing.
6. Open a sub-chat under this chat in **Chats**, or from its **Sub-chats** tab.

The agent can split again later. A piece that can't start is named with why; the others start.

## What each piece starts with

| It gets                         | From                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| Agent, model, effort, autonomy  | The parent chat as it is then, unless the agent chose another for that piece                  |
| [Mode](agent-mode.md)           | The parent's, never one that asks less often; another agent gets its closest mode at or below |
| Title, project and task         | The agent's plan. The task is the agent's text, [never your message](chat-messages.md)        |
| Its own branch                  | The default branch, or the branch of the piece it is **Stacked on**                           |
| **Held** instead of **Working** | A piece that is stacked on another, or starts after others                                    |

After the start the sub-chat is yours: change its model, mode or autonomy there. Each one publishes under its own mode and [autonomy](spark-autonomy.md), and Spark never merges.

> **Note:** The parent's agent can stop a sub-chat's turn (`spark_stop_chat`) and message it. It can't raise a sub-chat's mode, and its task can't allow a push or a pull request. Agents see a chat's `parent` and `subChats` in `spark_chats` and `spark_chat`.

**Next:** [Reports and the wrap-up](sub-chat-reports.md)
