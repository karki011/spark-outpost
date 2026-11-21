---
title: Sub-chats
section: Chats
type: concept
order: 236
summary: Chats an agent starts to split one job, nested under their parent.
---

When an agent splits a job, each piece runs in its own sub-chat under the chat that started it, the parent. A sub-chat is an ordinary chat: what you type there is your message to it.

Only an agent starts one: [ask it to split the job](split-into-sub-chats.md). One level only: a piece can't split again.

## Find a sub-chat

| Where                              | What you see                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Chats** side panel               | Sub-chats sit under their parent in plan order, joined by lines, and are not listed again under their project          |
| Parent row                         | An arrow hides or shows its sub-chats, and a count says how many need you                                              |
| Sub-chat row                       | Its status: **Needs you**, **Working**, **Held**, **Ready for review** or **Done**                                     |
| **History**, search, Home, island  | A plain row marked **↳** with the parent's name                                                                        |
| After the parent is deleted        | The sub-chat stays as a chat of its own, marked **was part of** with the parent's name                                 |
| Top of a sub-chat                  | **‹** and the parent's name lead back to the parent; the status sits beside the title                                  |
| Parent's Work panel, **Sub-chats** | Every sub-chat by status, with its branch, pull request, model and what it waits for; **Open ›** on one that needs you |
| First item in a sub-chat           | **Task from** the parent: the task and what the sub-chat started with                                                  |

With a row focused, **←** hides a parent's sub-chats or moves from a sub-chat to its parent, and **→** shows them or moves into them. Spark remembers which parents you hid.

## Statuses

| Status               | Means                                                             |
| -------------------- | ----------------------------------------------------------------- |
| **Needs you**        | A card or question waits, or its last turn failed or was stopped  |
| **Working**          | A turn is running or about to start                               |
| **Held**             | It has not started yet; see [when it starts](sub-chat-reports.md) |
| **Ready for review** | It finished with an open pull request or kept changes             |
| **Done**             | It finished with nothing left to review, or it is archived        |
