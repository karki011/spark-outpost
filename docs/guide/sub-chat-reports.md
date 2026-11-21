---
title: Reports and the wrap-up
section: Chats
type: concept
order: 239
summary: What a sub-chat reports to its parent, when a waiting sub-chat starts, and the wrap-up the parent writes at the end.
---

When a [sub-chat](sub-chats.md) finishes its task, Spark sends its parent a report. When every sub-chat has ended, the parent writes one wrap-up for you.

## The report

| Part                        | Comes from                                                   |
| --------------------------- | ------------------------------------------------------------ |
| **Status**                  | Spark. A failed or stopped turn reads **Needs you** with why |
| **Changed**                 | The sub-chat's reply                                         |
| **Branch and pull request** | Spark's own record: branch, committed, pushed, pull request  |
| **Risks**, **Blockers**     | The sub-chat's reply; **None stated** when it named none     |

The parent shows it as a **Report** block. The reply's parts are the sub-chat agent's words, not checked by Spark.

A report is [never your message](chat-messages.md) in the parent: it starts a turn there, or joins the running one, and allows no push or pull request. In that turn the parent's agent may message and stop only its own sub-chats.

What you type in a sub-chat later updates its row without waking the parent.

## When a Held sub-chat starts

| It waits for                    | Spark                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| Sub-chats that all reported     | Starts it by itself                                                |
| One that failed or was stopped  | Keeps it **Held** and says which one; **Start anyway** starts it   |
| One you deleted or archived     | Stops waiting for that one                                         |
| A sub-chat it is stacked on     | First commits that chat's kept changes on its branch, never pushed |
| Anything, while Spark is paused | Waits until you resume                                             |

If that commit can't be made, it stays **Held**. **Start anyway** is on its row in the **Sub-chats** tab. See [Stacked pull requests](stacked-pull-requests.md).

## The wrap-up

When no sub-chat is working and none can still start by itself, Spark sends the parent one wrap-up.

| The wrap-up             | Is                                                                       |
| ----------------------- | ------------------------------------------------------------------------ |
| What Spark sends        | Each sub-chat's status with Spark's record, and the order to merge       |
| The parent's answer     | A read-only turn: no file changes, no push, no pull request, in any mode |
| After you add sub-chats | One more wrap-up when those have ended                                   |
