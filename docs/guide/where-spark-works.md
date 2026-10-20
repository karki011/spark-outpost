---
title: Choose where a chat works
section: Projects and shipping
type: how-to
order: 310
summary: Let each chat work in its own git worktree, start it from another branch, or have it edit your files directly.
---

You'll choose whether a chat works in its own copy of the project or in your files. About 1 minute.

By default each chat in a mode that can change files gets its own git worktree on a new branch with its first message, so your checkout stays untouched.

## For one chat

1. In the context bar, select the branch chip next to the project.
2. Pick **New branch from** _branch_, a branch under **Or continue a branch**, **Work on a pull request…** or **Edit my files directly instead**.

Hover the chip to see where the branch started and how pull requests open.

## Work on a pull request

**Work on a pull request…**, in the chip or **Work** panel, adopts one. Only you can, on the Mac.

- The agent pushes there without force, merges to update and handles [feedback](pr-follow-up.md).
- A fork needs maintainer edits allowed. Otherwise, or for a protected branch, the chat gets a `spark/` branch from it.

## For every chat in a project

1. Open **Settings → Projects** and select the project.
2. Under **Where Spark works**, pick **Each chat in its own worktree (recommended)** or **In my files**.

## What to expect

| Choice   | Where changes land                | To get them into your checkout                          |
| -------- | --------------------------------- | ------------------------------------------------------- |
| Worktree | On the chat's own `spark/` branch | **Bring changes into** _branch_, or open a pull request |
| My files | Straight in your checkout         | Nothing to do                                           |

A new worktree starts from the latest `origin` default branch, unless your checkout has its own commits or you picked a branch.

When its lockfile differs from your checkout's, Spark installs dependencies there and says so if that fails.

**Next:** [Keep files and keys away from agents](sparkignore.md)
