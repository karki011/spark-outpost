---
title: Start a workflow on an event
section: Chats
type: how-to
order: 231
summary: Have a workflow run in a chat when a turn changes files, before publish, on a new commit or when Spark's pull request updates.
---

A triggered workflow runs in the chat that set it off, on that chat's worktree and branch. About 2 minutes.

1. Open **Sparks**, then **Workflows**, and choose **Edit** on a saved workflow.
2. Open the **Triggers** tab and turn on the events you want.
3. Pick **In project**, or leave **Any project**.
4. Set **Wait after the last trigger** so a burst of turns starts one run.
5. Choose **Save triggers**.

## The events

| Event                               | When it runs                                                 |
| ----------------------------------- | ------------------------------------------------------------ |
| **A turn changes files**            | After a Do turn keeps changes, within about 30 seconds.      |
| **Before publish**                  | At Full auto → PR, inside the turn, before Spark pushes.     |
| **A new commit on the branch**      | After a turn adds a commit. **Only on branches** filters.    |
| **A pull request opens or updates** | When a pull request Spark opened appears or gets a new head. |

Spark skips a run when the chat's changes match the last run.

## Hold the publish

With **Hold the publish while Critical or High findings are open**, steps mark findings **[Critical]**, **[High]**, **[Medium]** or **[Low]**. A Critical or High finding, or an unfinished review, holds the publish.

- Fix it: the next Full auto turn reviews again.
- **Release hold** under **Held publishes**: nothing is pushed until the next Full auto turn.
- Ask for the publish in a message.
- **Stop** during the review: nothing is published.

## Let runs change files

With **Triggered and scheduled runs may change files**, steps on Claude edit the chat's own worktree and leave changes uncommitted. Commits, pushes, pull requests and installs stay refused. Before publish only reads.

> **Important:** A triggered run is not your message. It can't ask for a push, a pull request or a Spark action.

Triggers are set on the Mac only.

**Next:** [Run a workflow on a schedule](workflow-schedules.md)
