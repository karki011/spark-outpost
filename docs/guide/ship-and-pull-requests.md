---
title: Ship a change
section: Projects and shipping
type: how-to
order: 320
summary: Commit, push or open a pull request from a chat, and choose whether pull requests open ready for review or as drafts.
---

You'll ship a finished change as a commit, a pushed branch or a pull request. About 2 minutes.

1. Select the ship button on the chat's outcome card or in the **Changes** tab of the **Work** panel. It reads **Open PR**, **Push branch** or **Commit**.
2. In **Ship this task**, pick **Commit**, **Push** or **PR** under **How to ship**.
3. Check the branch, the files and the **Pull request title**.
4. Select **Open PR**, **Push branch** or **Commit**.

![Ship this task with the PR option, branch and files](images/ship-panel-light.png)

Ship commits only the task's own files and leaves secret files out. Once a PR exists, the button reads **Update PR**. Spark never merges a pull request.

## How Spark pushes and opens the PR

Spark does it itself, so your credentials never reach the agent.

| Step        | Spark tries, in order                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Push        | Your own git login, then your GitHub sign-in or saved token. Neither is written to git config or logs.            |
| Open the PR | Your GitHub sign-in for repositories it covers, then a token, your `gh` login, or a **Create PR on GitHub** link. |

GitLab and Bitbucket remotes get a link to their merge request page. Hover the chat's branch chip to see the route.

## Ready for review or draft

1. Open **Settings → Spark** and find **Pull requests**.
2. Set **Open pull requests as** to **Ready for review** (the default) or **Draft**.

## When checks still fail in Full auto

At **Full auto → PR**, Spark ships by itself. **When checks still fail in Full auto** in **Settings → Spark** decides what happens:

| Choice                        | Result                                           |
| ----------------------------- | ------------------------------------------------ |
| **Open a draft PR** (default) | The PR opens as a draft marked "Checks failing". |
| **Stop and ask**              | Spark stops before shipping and asks you.        |

**Next:** [Let Spark handle PR feedback](pr-follow-up.md)
