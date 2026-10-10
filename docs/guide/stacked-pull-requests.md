---
title: Stacked pull requests
section: Projects and shipping
type: concept
order: 324
summary: How a sub-task that starts after another in the same project builds on that branch, where its pull request points, and how to update and merge the stack.
---

A sub-task that starts after another one in the same project branches from that one's `spark/*` branch, and its pull request targets that branch. Updating is always a merge; nothing rebases or force pushes.

## Parallel or stacked

| In the draft                                 | Branch starts from | Pull request targets |
| -------------------------------------------- | ------------------ | -------------------- |
| **Starts after**: **Nothing**                | The default branch | The default branch   |
| **Starts after** `@api`, same project        | `@api`'s branch    | `@api`'s branch      |
| **Starts after** `@api`, a different project | The default branch | The default branch   |

The proposing chat picks parallel or stacked; you can change it before you [start the story](outpost-stories.md). A different branch you choose for the chat, or **Edit my files**, wins over the stack.

## What you see

The **Story** bar shows each pull request as a chip, such as **#124 → #123** or **#124 → main**, with warnings as text.

| Warning or line                             | Do                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| "@api has commits that @fe does not have"   | Select **Update from @api** and send the request. `@fe` merges that branch.                         |
| "Merging this now would not reach main"     | Select **Update from the default branch**, so `@fe`'s pull request targets it.                      |
| **Needs you: @api's branch is not pushed.** | Have `@api` push first. Until then Spark refuses `@fe`'s push, because it carries `@api`'s commits. |

## What stays the same

- A chat pushes only its own `spark/*` branch and never force pushes.
- Nothing merges. Merge the pull requests yourself, in the order the bar shows.
- Once `@api`'s pull request is merged or closed, a new pull request from `@fe` targets the default branch.

See [Ship a change](ship-and-pull-requests.md) and [What an outpost request may do](outpost-permissions.md).
