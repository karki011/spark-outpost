---
title: Work across chats in an outpost
section: Chats
type: how-to
order: 232
summary: Put several chats in one outpost, ask each for work with @ and its handle, and read every answer in one thread.
---

Ask several chats from one thread. About 3 minutes. See [When to use an outpost](when-to-use-an-outpost.md).

## Create an outpost

1. Select **New outpost** (**+**) beside **Outposts** and enter a **Name**.
2. Add each **Existing chat**, or a **New chat** with a **Project**, **Agent** and **Permissions**. Check its handle, like `api`.
3. Optionally **Add a first message** and files: your first request.
4. Select **Continue**, check the review, then **Start outpost**. The thread introduces each chat.

Or use **Add to outpost** in a chat's row menu. A chat joins one outpost; Terminal sessions can't.

## Send a request

1. Type a request with `@api` anywhere, several handles or `@all`. **Asks:** lists them; remove one to only mention it. Then **Send request**.
2. A card per chat lands under it with its [state](statuses-and-limits.md#outpost-requests), branch and pull request, and **Answer**, **Review PR**, **Open** or **Stop…** where they fit. Another chat's request says **not from you**.
3. **Open** shows that chat's thread; typing there **Sends to @api as you**.

No handle: **Post note** starts no work.

| Select                    | To                                                        |
| ------------------------- | --------------------------------------------------------- |
| **Overview** (panel icon) | Threads by state, **Library** files, **Pull requests**.   |
| **Pause** / **Resume**    | Hold requests that haven't started. Running turns finish. |
| The outpost's name        | **Rename…**, **Outpost Settings…** or **Instructions…**.  |

**Instructions…** go beside every request: never your message, granting nothing.

## In the chat

| You see                          | Means                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| A chip with the outpost's name   | Opens it.                                                         |
| **From you**, heading a turn     | A request started this turn, under this chat's mode and autonomy. |
| **Outpost request** in the queue | The chat is busy or its last turn stopped (**Send now**).         |

A request you type counts as your message: "open a PR" [publishes](ship-and-pull-requests.md#when-the-agent-publishes). Why: [What an outpost request may do](outpost-permissions.md).

Agents can [ask each other](outpost-asks.md) and [start sub-tasks](outpost-stories.md). A [paired device](use-your-phone.md) can read, post, answer, cancel, pause, rename and start drafts, nothing more.

**Next:** [Choose where a chat works](where-spark-works.md)
