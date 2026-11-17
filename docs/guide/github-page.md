---
title: Work from the GitHub page
section: Projects and shipping
type: how-to
order: 333
summary: See the pull requests that need you on the GitHub page, grouped into reviews, fixes, ready to merge and waiting, and open one on GitHub or in its chat.
---

You'll find the pull requests that need you. About 2 minutes. The GitHub page is in the Mac app only.

First [connect GitHub](tickets-and-github.md#connect-github). Until then the page shows **Open Connectors**.

## Find your pull requests

1. Select **GitHub** in the left bar. A dot on it means something new.
2. Pick a group: **Review requested**, **Needs fixes**, **Ready to merge** or **Waiting on others**. Arrow keys move between them.
3. Narrow with **Last 14 days** or **Last 30 days**, and with **All projects** or one project.
4. Select **Refresh pull requests** to check GitHub now.

Each row shows a dot while new, the author, the ticket key, the checks (**Passing**, **Failing**, **Running**, **Conflict** or **Draft**), **New commits** when it changed since you looked, and the latest review.

Bot pull requests you were asked to review share one **Dependency updates** row; select it to list them.

If a repository can't be read, a line under the title says why and the page keeps the last list.

## Open a pull request

1. Select a row, or press ↓ and ↑ to reach it and Return to open it. This marks it seen.
2. The details show checks, size, who it waits on, who approved and its ticket. Select the ticket to open it in **Tickets**.
3. Select **Open chat** to go to the chat that opened it, or **Open on GitHub**.

Press Esc to close the details.

## Review with a Spark or workflow

1. Select **Auto-review** at the top, or open **Settings → GitHub**.
2. Under **Review with**, pick a Spark or workflow; its own instructions apply. None yet? **Open Sparks**.
3. Turn on **Review automatically**: requested reviews run, again on new commits. Drafts wait.
4. **Reviewer may post to GitHub** lets it post on that pull request and nowhere else. **Reviewer may approve** needs posting; it never merges.

**Next:** [Read a pull request review](review-pull-requests.md)
