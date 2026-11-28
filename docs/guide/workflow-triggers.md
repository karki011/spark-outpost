---
title: Start a workflow on an event
nav: Start on an event
section: Sparks and workflows
type: how-to
order: 580
summary: Have a workflow run in a chat when it starts, when a turn changes files, before publish, on a new commit or when Spark's pull request updates.
---

A triggered workflow runs in the chat that set it off, on its worktree and branch. About 2 minutes.

1. Open **Sparks**, **Workflows**, then **Edit** on a workflow.
2. Open **When it runs** and turn on the events you want.
3. Under **Where**, pick a **Project**, or leave **Any project**. The schedule shares it.
4. Set **Wait** so a burst starts one run.
5. Choose **Save**.

## The events

| Event                               | When it runs                                                 |
| ----------------------------------- | ------------------------------------------------------------ |
| **A chat starts**                   | After the first turn of a new chat succeeds.                 |
| **A turn changes files**            | After a Do turn keeps changes.                               |
| **Before publish**                  | At Full auto → PR, inside the turn, before Spark pushes.     |
| **A new commit on the branch**      | After a turn adds a commit. **Only on branches** filters.    |
| **A pull request opens or updates** | When a pull request Spark opened appears or gets a new head. |

Spark skips a run when the chat's changes match the last run. **A chat starts** ignores chats Spark or a workflow started.

**Tell the chat's agent only when there are findings** sends finding lines, nothing after a clean run.

## Hold the publish

With **Hold the publish while Critical or High findings are open**, steps mark findings by severity. A Critical or High finding, or an unfinished review, holds the publish.

- Fix it; the next turn reviews again.
- **Release hold** on the **Runs** tab; the next Full auto turn publishes.
- Ask for the publish, or **Stop** the review to publish nothing.

## Let runs change files

With **Triggered and scheduled runs may change files**, Claude steps may leave uncommitted edits in the chat's worktree. Commits, pushes, pull requests and installs stay refused. Before publish only reads.

> **Important:** A triggered run is not your message. It can't ask for a push, pull request or Spark action.

Set triggers on the Mac.

**Next:** [Run a workflow on a schedule](workflow-schedules.md)
