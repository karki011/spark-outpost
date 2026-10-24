---
title: Stacked pull requests
section: Projects and shipping
type: concept
order: 324
summary: How a sub-task that starts after another in the same project builds on that branch, where its pull request points, and how to update and merge the stack.
---

A sub-task that starts after another in the same project branches from that chat's `spark/*` branch, and its pull request targets it. Spark first commits the chat's kept changes there. Updating is a merge; nothing rebases.

## Parallel or stacked

| In the draft                                 | Branch starts from | Pull request targets |
| -------------------------------------------- | ------------------ | -------------------- |
| **Starts after**: **Nothing**                | The default branch | The default branch   |
| **Starts after** `@api`, same project        | `@api`'s branch    | `@api`'s branch      |
| **Starts after** `@api`, a different project | The default branch | The default branch   |

The proposing chat picks parallel or stacked; change it before you [start the story](outpost-stories.md). A different branch you choose for the chat, or **Edit my files**, wins over the stack.

## What you see

The **Story** bar shows each pull request as a chip, such as **#124 → #123** or **#124 → main**, with warnings as text.

| Warning or line                             | Do                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| "@api has commits that @fe does not have"   | Select **Update from @api** and send the request. `@fe` merges that branch.                                                             |
| "Merging this now would not reach main"     | Select **Update from the default branch**, so `@fe`'s pull request targets it.                                                          |
| **Needs you: @api's branch is not pushed.** | Have `@api` push first; until then Spark refuses `@fe`'s push, which carries `@api`'s commits. Unreviewed modes get a [flag](cards.md). |

## What stays the same

- With the recommended [rules](protected-paths.md#spark-rules), a chat pushes only its own `spark/*` branch; force pushes need a lease and confirmation.
- Nothing merges; you merge them, in the bar's order.
- Once `@api`'s pull request merges or closes, `@fe`'s new pull request targets the default branch.

See [Ship a change](ship-and-pull-requests.md) and [What an outpost request may do](outpost-permissions.md).
