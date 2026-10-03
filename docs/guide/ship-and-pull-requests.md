---
title: Ship a change
section: Ship and pull requests
type: how-to
order: 510
summary: Commit, push or open a pull request from a chat, and choose whether pull requests open ready for review or as drafts.
---

You'll ship a finished change as a commit, a pushed branch or a pull request. About 2 minutes.

1. When a change is kept, find the ship button on the chat's outcome card or in the **Changes** tab of the **Work** panel. It reads **Open PR**, **Push branch** or **Commit**.
2. Select it. **Ship this task** opens.
3. Under **How to ship**, pick **Commit**, **Push** or **PR**, if more than one is possible.
4. Check the branch, the files and the **Pull request title**.
5. Select **Open PR** (or **Push branch**, **Commit**).

![Ship this task with the PR option, branch and files](images/ship-panel-light.png)

The chat says what happened, such as "Opened PR #12.". Ship commits only the task's own files and leaves secret files out. After a PR exists, the button reads **Update PR**.

## How Spark pushes and opens the PR

Spark does it itself, so your credentials never reach the agent.

| Step        | Spark tries, in order                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Push        | Your own git login, then a saved GitHub token. The token is never written to git config or logs. |
| Open the PR | The GitHub connection, then your `gh` login, then a **Create PR on GitHub** link.                |

GitLab and Bitbucket remotes get a link to their merge request page. Hover the chat's branch chip to see the route, such as **PRs via GitHub connection** or **Push only · PR link**.

## Ready for review or draft

1. Open **Settings → Spark** and find **Pull requests**.
2. Set **Open pull requests as** to **Ready for review** (the default) or **Draft**.

## When checks still fail in Full auto

At **Full auto → PR**, Spark ships by itself. **When checks still fail in Full auto** in **Settings → Spark** decides what happens if checks fail:

- **Open a draft PR** (default): the PR opens as a draft marked "Checks failing".
- **Stop and ask**: Spark stops before shipping and asks you.

Spark never merges a pull request.

**Next:** [Let Spark handle PR feedback](pr-follow-up.md)
