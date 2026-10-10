---
title: Agents asking each other
section: Understand Spark
type: concept
order: 517
summary: How an agent in an outpost asks another member, leaves a note or reads the thread, where you see it, and why such a request is never your message.
---

In an outpost an agent can ask another member for work or an answer, without you passing it on. The request is the agent's, never yours: it runs under the receiving chat's own mode and autonomy.

## What an agent can do

| The agent                                | You see                                                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Asks `@api`                              | A request from `@fe` marked **not from you** in the thread, and **To @api** under `@fe`'s turn. |
| Waits for the answer, or goes on         | The answer under the request. One it didn't wait for reaches it at its next turn.               |
| Leaves a note                            | A note in the thread. Members read it at their next turn; it starts no work.                    |
| Reads the outpost                        | Nothing new. Reading another member's notes or answer counts as reading private work data.      |
| [Proposes sub-tasks](outpost-stories.md) | A draft that you review and start.                                                              |

In the receiving chat the turn is headed **From @fe** · **not from you**.

## What keeps it bounded

| Rule                                                  | Means                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A turn that a request started can't ask or propose.   | It answers, and the chain ends there.                                                          |
| No `@all`, and no asking itself.                      | One member per request.                                                                        |
| Two agents can't wait on each other.                  | The second ask is sent without waiting.                                                        |
| While the outpost is paused, an agent can't ask.      | **Resume** first.                                                                              |
| What a turn read travels with its request and answer. | A later send off this computer is [flagged](privacy-and-secrets.md) in the receiving chat too. |

There are no caps or timers. Every request is in the thread, and you can **Cancel** it or stop its turn.

See [What an outpost request may do](outpost-permissions.md) and the [outpost tools](spark-tools.md#outpost-tools).
