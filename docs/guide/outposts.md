---
title: Work across chats in an outpost
section: Chats
type: how-to
order: 232
summary: Put several chats in one outpost, ask each for work with @ and its handle, and read every answer in one thread.
---

You'll ask several chats for work from one thread. About 3 minutes.

## Create an outpost

1. Select **New outpost** (**+**) beside **Outposts**, enter a **Name**.
2. Add each **Existing chat**, or a **New chat** with a **Project**, **Agent** and **Permissions**. Check its handle, like `api`.
3. Optionally **Add a first message** with files: your first request.
4. Select **Continue**, then **Start outpost**.

Or select **Add to outpost** in a chat's row menu. A chat joins one outpost; Terminal sessions can't.

## Send a request

1. Type `@api` and your request, then select **Send request**.
2. The answer lands under it with its [state](statuses-and-limits.md#outpost-requests), branch, files and pull request.
3. On **Needs you**, select **Answer**, then **Send answer**. For an approval card, **Open in chat**.

Without a handle, **Post note** starts no work.

| Select                 | To                                                        |
| ---------------------- | --------------------------------------------------------- |
| **Cancel**             | Stop a request.                                           |
| **Pause** / **Resume** | Hold requests that haven't started. Running turns finish. |
| **Edit outpost**       | Rename, change chats and handles, or delete. Chats stay.  |

## In the chat

| You see                          | Means                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| A chip with the outpost's name   | Opens it.                                                         |
| **From you**, heading a turn     | A request started this turn, under this chat's mode and autonomy. |
| **Outpost request** in the queue | The chat is busy. You can remove it, not edit it.                 |

A request you type counts as your message: "open a PR" [publishes](ship-and-pull-requests.md#when-the-agent-publishes), and `/plan` runs as a command. Text you didn't write never asks for a push, pull request or Spark action.

Agents can't ask each other yet.

**Next:** [Choose where a chat works](where-spark-works.md)
