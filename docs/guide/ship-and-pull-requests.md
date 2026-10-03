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
- **Open a pull request** works for any GitHub remote. With GitHub connected in **Settings → Connectors** Spark opens it for you; without it, Spark pushes and gives you a **Create PR on GitHub** link. See [Tickets and GitHub](tickets-and-github.md#connect-github).

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

## How Spark pushes and opens the PR

Spark pushes and opens pull requests itself, so your credentials never reach the agent. It tries, in order:

1. **Push** with your own git login. If GitHub refuses it and a GitHub token is saved, Spark retries once with the token. The token is never written to git config or logs. If neither works, the error shows the exact `git push` command to try in a terminal.
2. **Open the PR** with the GitHub connection, then your `gh` login, else a **Create PR on GitHub** link with the title and body filled in. GitLab and Bitbucket remotes get a link to their merge request page; other hosts get the pushed branch name.

Hover the chat's branch chip to see the route, for example **PRs via GitHub connection** or **Push only · PR link**. **Settings → Connectors → GitHub** shows it too; select **Test** to check each project's remote and sign-in without changing anything. When only a link was made, the ticket shows it under **Linked work**.

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
