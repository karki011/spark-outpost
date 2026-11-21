---
title: Stacked pull requests
section: Projects and shipping
type: concept
order: 324
summary: How a sub-chat stacked on another builds on that branch, where its pull request points, when it starts, and how to update and merge the stack.
---

A [sub-chat](sub-chats.md) stacked on another builds on that sub-chat's `spark/*` branch, where Spark first commits its kept changes. Updating is a merge; nothing rebases.

## Parallel or stacked

| On the plan card               | Branch starts from  | Pull request targets |
| ------------------------------ | ------------------- | -------------------- |
| **New branch**                 | The default branch  | The default branch   |
| **Stacked on 1**, same project | Sub-chat 1's branch | Sub-chat 1's branch  |
| **Starts after 1, 2**          | The default branch  | The default branch   |

The agent that [splits the job](split-into-sub-chats.md) picks parallel or stacked. **Starts after** is order only.

## When it starts

A stacked sub-chat is **Held** until the one below it has [reported](sub-chat-reports.md). Spark then commits that sub-chat's kept changes on its own branch, a local commit that is never pushed, and starts the stacked one.

If the commit can't be made, or the one below failed or was stopped, it stays **Held**.

## Pushing and merging

| Rule                                                            | Why                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| A sub-chat pushes only its own `spark/*` branch                 | With the recommended [rules](protected-paths.md#spark-rules) |
| Its push is refused while the branch below is not on the remote | The push would carry that branch's commits                   |
| In a mode Spark can't review, that push gets a [flag](cards.md) | Spark never stops the run                                    |
| Nothing merges; you merge, base first                           | The parent's wrap-up gives the order                         |
| Once the pull request below merges or closes                    | A new pull request targets the default branch                |

Outpost stories stack the same way; their **Story** bar shows each pull request and its warnings. See [Stories](outpost-stories.md), [Ship a change](ship-and-pull-requests.md) and [What an outpost request may do](outpost-permissions.md).
