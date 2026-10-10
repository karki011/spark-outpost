---
title: Start a story of sub-tasks
section: Chats
type: how-to
order: 233
summary: Let a chat propose a story, a job split across several chats, then review the draft, start it, and follow its order, pull requests and wrap-up.
---

You'll have one chat split a job across several, and start them yourself. About 3 minutes.

## Review and start

1. In a chat with a project, ask it to propose sub-tasks for the job. It needs no outpost yet.
2. Its reply shows **Proposed 3 chats · 1 stacked**. Nothing exists yet. Select **Review and start**.
3. Check each chat's **Agent**, **Permissions**, first message and the two fields below.
4. Select **Continue**, then **Start outpost**. When the proposing chat is already in an outpost, the sheet reads **Add chats to …** and the button **Start chats**.

| Field            | Choose                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Starts after** | **Nothing**, or a handle such as `@api`: the chat waits until `@api` has answered.                                          |
| **Pull request** | **Pull request, parallel**, **Pull request, stacked on @api** ([stacked](stacked-pull-requests.md)) or **No pull request**. |

**Pull request** sets the new chat's [autonomy](spark-autonomy.md). First messages are sent as the proposing chat's, [not yours](outpost-permissions.md), so their words open no pull request.

A proposed chat's mode asks at least as often as the proposing chat's. Change **Permissions** yourself to give it more.

## Follow the story

The **Story** bar under the outpost's chats reads, for example, **Checkout · 1 of 3 answered · 2 PRs**. Open it for each sub-task's order, state, pull request and warnings.

| You see                  | Means                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Waiting for @api**     | Held until `@api` reads **Answered**, then it starts by itself. If `@api` failed, select **Start anyway** or **Cancel**. |
| **Update from @api**     | Fills the message box with a merge request for you to send.                                                              |
| A request from **Spark** | Every sub-task ended. The proposing chat answers once with a wrap-up; it starts no new work.                             |
| **Pause**                | Also holds waiting sub-tasks.                                                                                            |

On a [paired phone](use-your-phone.md) the draft reads **Review and start on your Mac**.

**Next:** [Choose where a chat works](where-spark-works.md)
