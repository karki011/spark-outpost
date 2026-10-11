---
title: Ship a change
section: Projects and shipping
type: how-to
order: 320
summary: Commit, push or open a pull request from a chat, and choose whether pull requests open ready for review or as drafts.
---

You'll ship a finished change as a commit, a pushed branch or a pull request. About 2 minutes.

1. Select the ship button in the **Changes** tab of the **Work** panel. It reads **Open PR**, **Push branch** or **Commit**.
2. In **Ship this task**, pick **Commit**, **Push** or **PR** under **How to ship**.
3. Check the branch, the files and the **Pull request title**.
4. Select **Open PR**, **Push branch** or **Commit**.

![Ship this task with the PR option, branch and files](images/ship-panel-light.png)

Ship commits only the task's own files, without secret files. Once a PR exists, the button reads **Update PR**. Nothing merges.

## When the agent publishes

Ask for a pull request in your message, or set **Full auto → PR**. After its reply, Spark asks the agent once to push the branch and open the PR; at **Full auto → PR** only when the turn changed files.

The result shows under the reply.

In an outpost: [requests](outpost-permissions.md), [stacks](stacked-pull-requests.md).

| The chat says                                               | Meaning                                           |
| ----------------------------------------------------------- | ------------------------------------------------- |
| **Opened pull request #12**                                 | Spark tracks it.                                  |
| "The branch was pushed, but no pull request was opened."    | Use the link to create it.                        |
| **Push stopped by the pre-push check**, with its last lines | Nothing was pushed.                               |
| "Not published: …"                                          | Kept, not pushed. Ask again, or ship it yourself. |
| "Committed … not pushed."                                   | The project has no remote.                        |

The push uses your shell's logins; tokens never reach the agent. Without `gh`, the PR opens through your GitHub sign-in.

Every pull request from the chat or its terminal shows above the message box (state, number, repository, lines changed) and under **Links** with checks, reviews and comments. **Refresh** re-reads one from GitHub. A reopened one shows **Open** again.

## Ready for review or draft

In **Settings → Spark**, set **Open pull requests as** to **Ready for review** (the default) or **Draft**. You can also ask for a draft in your message.

**Next:** [Let Spark handle PR feedback](pr-follow-up.md)
