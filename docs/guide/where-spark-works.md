---
title: Choose where a chat works
section: Projects and shipping
type: how-to
order: 310
summary: Let each chat work in its own git worktree, start it from another branch, or have it edit your files directly.
---

You'll choose whether a chat works in its own copy or in your files. About 1 minute.

By default a chat in a mode that can change files gets its own git worktree and new branch with its first message.

## For one chat

1. Select the branch chip under the message box.
2. Pick **New branch from** _branch_, a branch under **Or continue a branch**, **Work on a pull request…** or **Edit my files directly instead**.

Hovering the chip shows where the branch started and how pull requests open.

## Work on a pull request

**Work on a pull request…**, in the chip or **Work** panel, adopts one (only you, on the Mac).

- The agent pushes there without force, merges to update and handles [feedback](pr-follow-up.md).
- A fork needs maintainer edits allowed. Otherwise, or for a protected branch, the chat gets a `spark/` branch from it.

## For every chat in a project

1. In **Settings → Projects**, select the project.
2. Under **Where Spark works**, pick **Each chat in its own worktree (recommended)** or **In my files**.

## Link a repo by name

Ask about a repo the chat lacks, like "the identity repo". The agent searches projects and **Repos folders**, then asks on a **Link** card in every mode.

1. In **Settings → Projects**, under **Repos folders**, select **Add repos folder…**.
2. Choose where you clone repos.

## What to expect

| Choice   | Where changes land                | To get them into your checkout                          |
| -------- | --------------------------------- | ------------------------------------------------------- |
| Worktree | On the chat's own `spark/` branch | **Bring changes into** _branch_, or open a pull request |
| My files | Your checkout                     | Nothing to do                                           |

A new worktree starts from the latest `origin` default branch, unless your checkout has its own commits or you picked a branch.

If its lockfile differs from your checkout's, Spark installs dependencies there, saying so if that fails.

**Next:** [Keep files and keys away from agents](sparkignore.md)
