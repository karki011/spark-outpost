---
title: Ship a change
section: Projects and shipping
type: how-to
order: 320
summary: Commit, push or open a pull request from a chat, and choose whether pull requests open ready for review or as drafts.
---

Ship a finished change as a commit, pushed branch or pull request. About 2 minutes.

1. In the **Work** panel's **Changes** tab, select the ship button: **Open PR**, **Push branch** or **Commit**.
2. In **Ship this task**, pick **Commit**, **Push** or **PR** under **How to ship**.
3. Check the branch, files and **Pull request title**.
4. Select **Open PR**, **Push branch** or **Commit**.

![Ship this task with the PR option, branch and files](images/ship-panel-light.png)

Ship commits only the task's own files, without secret files. Once a PR exists, the button reads **Update PR**. Nothing merges.

## When the agent publishes

Ask for a pull request in your message, or set **Full auto → PR**. After its reply, Spark asks the agent to push and open the PR; at **Full auto → PR** only when the turn changed files.

In an outpost: [requests](outpost-permissions.md), [stacks](stacked-pull-requests.md).

| First under the reply                                       | Meaning                                  |
| ----------------------------------------------------------- | ---------------------------------------- |
| **Opened pull request #12**                                 | Spark tracks it.                         |
| "The branch was pushed, but no pull request was opened."    | Create it from the link.                 |
| "Pushed …"                                                  | You asked only to push.                  |
| **Push stopped by the pre-push check**, with its last lines | Nothing was pushed.                      |
| "Not published: …"                                          | Kept, not pushed. Ask again, or ship it. |
| "Committed … not pushed."                                   | No remote.                               |

The push uses your shell's logins; tokens never reach the agent. Without `gh`, the PR opens through your GitHub sign-in.

Every pull request from the chat or its terminal shows above the message box and under **Links** with checks, reviews and comments. **Refresh** re-reads one from GitHub; a reopened one shows **Open** again.

## Ready for review or draft

In **Settings → Pull requests**, set **Open pull requests as** to **Ready for review** (default) or **Draft**. Or ask for a draft in your message.

**Next:** [Let Spark handle PR feedback](pr-follow-up.md)
