---
title: Ship and pull requests
section: Work with Spark
order: 240
summary: Commit, push or open a pull request from a chat, and choose whether pull requests open ready for review or as drafts.
---

You'll ship a finished change from a chat as a commit, a pushed branch or a pull request. About 2 minutes.

## Before you ship

What Ship can do depends on the repo:

- **Commit** works in any git repo.
- **Push** needs a remote.
- **Open a pull request** needs the remote on GitHub and GitHub connected in **Settings → Connectors**. See [Tickets and GitHub](tickets-and-github.md#connect-github).

Ship waits until the task has finished working.

## Commit, push or open a PR

1. When a change is kept, find the ship button on the chat's outcome card, or in the **Changes** tab of the **Work** panel. It reads **Open PR**, **Push branch** or **Commit**, whichever the repo allows.
2. Select it. **Ship this task** opens.
3. If more than one way is possible, pick one under **How to ship**: **Commit**, **Push** or **PR**.
4. Check the branch, the files to commit and the **Pull request title** (or **Commit title**).
5. Select **Open PR** (or **Push branch**, **Commit**).

![Ship this task with the PR option, branch and files](images/ship-panel-light.png)

The chat then says what happened, for example "Opened PR #12.", with a link to it. Ship commits only the task's own files, never other changes in your checkout. After a PR exists, the button reads **Update PR**.

The pull request body lists a summary, linked tickets, the changed files, the checks Spark ran, any Critic findings, the agreed plan and the cost.

## Ready for review or draft

New pull requests open as **Ready for review** by default, so reviewers are asked right away. To open them as drafts instead:

1. Open **Settings → Spark** and find **Pull requests**.
2. Set **Open pull requests as** to **Draft**.

Mark a draft ready on GitHub when you are. The setting applies to every project.

## When checks still fail in Full auto

At **Full auto → PR**, Spark ships by itself when the work is done. If the project's checks still fail, **When checks still fail in Full auto** in **Settings → Spark** decides:

- **Open a draft PR** (default): the PR always opens as a draft marked "Checks failing", even when PRs normally open ready for review.
- **Stop and ask**: Spark stops before shipping and asks you.

Full auto never merges a pull request.

> **Tip:** After Spark opens a PR, it can keep an eye on its checks and review comments. See [Follow up on pull requests](pr-follow-up.md).

**Next:** [Follow up on pull requests](pr-follow-up.md)
