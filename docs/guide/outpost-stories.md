---
title: Start a story of sub-tasks
section: Chats
type: how-to
order: 233
summary: Let a chat start or propose a story, a job split across several chats, review a draft, and follow its order, pull requests and wrap-up.
---

You'll have one chat split a job across several chats. About 3 minutes.

## Start it from a chat

1. In a chat with a project, ask "split this into two parallel sub-chats and start them".
2. In **Auto**, **Bypass permissions**, **Approve for me** or **Full access** the agent starts them. Otherwise confirm its **Start these sub-chats?** card: **Start**, **Edit** or **Discard**.
3. The reply shows **Started outpost Docs split with 2 chats**. Select **Open**.

To check first, ask it to propose sub-tasks. The reply shows **Proposed 3 chats · 1 stacked**; **Review and start** opens the draft, with each chat's **Agent**, **Permissions**, first message and these fields:

| Field            | Choose                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Starts after** | **Nothing**, or a handle such as `@api`: the chat waits until `@api` has answered.                                          |
| **Pull request** | **Pull request, parallel**, **Pull request, stacked on @api** ([stacked](stacked-pull-requests.md)) or **No pull request**. |

First messages are the proposing chat's, [not yours](outpost-permissions.md), so they open no pull request. A sub-chat's mode asks at least as often as the proposing chat's; only you raise it. A sub-chat can't start more chats.

## Follow the story

In **Overview**, a **Story** row reads like **Checkout · 1 of 3 answered · 2 PRs**. Open it for each sub-task's order, state, pull request and warnings.

| You see                  | Means                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Waiting for @api**     | Held until `@api` is **Answered**, then it starts. **Waiting: @api's turn failed**: pick **Start anyway** or **Cancel**. |
| **Update from @api**     | Fills the message box with a merge request for you to send.                                                              |
| A request from **Spark** | Every sub-task ended. The proposing chat answers once, changing and publishing nothing.                                  |
| **Pause**                | Also holds waiting sub-tasks.                                                                                            |

**Next:** [Choose where a chat works](where-spark-works.md)
