---
title: Work from the GitHub page
section: Projects and shipping
type: how-to
order: 333
summary: See the pull requests that need you on the GitHub page, search them, read one's description and files, and start or open its chat.
---

About 2 minutes. Mac app only.

First [connect GitHub](tickets-and-github.md#connect-github). Until then the page shows **Open Connectors**.

## Find your pull requests

1. Select **GitHub** in the left bar. A dot on it means something new.
2. Pick a group: **Review requested**, **Needs fixes**, **Ready to merge**, **Waiting on others**, **Reviewed by you** or **Approved by you**. Arrow keys move between them.
3. Narrow with **Last 14 days** or **Last 30 days**, and with **All projects** or one project.
4. Spark checks every 2 minutes; **Refresh pull requests** checks now.

Rows show a new dot, author, ticket key, checks (**Passing**, **Failing**, **Running**, **Conflict**, **Draft**), **New commits**, the latest review, labels, and when it was opened and updated.

Pull requests you review come from every repository; your own from linked projects.

Bot pull requests share one **Dependency updates** row.

## Search

Press / or select **Search pull requests**. Each word must match a title, number, repository, author, branch, label, ticket or description. Esc clears.

## Open a pull request

1. Select a row, or press ↓ and ↑ and Return. This marks it seen.
2. Details show branches, the description, changed files, checks, size, assignees, reviewers and the ticket.
3. **Open chat** goes to its chat. **Start chat** makes one on its branch; outside linked projects, one without it. **Open on GitHub** opens it.

The page reopens on the pull request you last viewed, or the newest. Esc closes.

## Review with a Spark or workflow

1. Select **Auto-review** at the top, or open **Settings → GitHub**.
2. Under **Review with**, pick a Spark or workflow; its own instructions apply. None yet? **Open Sparks**.
3. Turn on **Review automatically**: requested reviews run, again on new commits. Drafts wait.
4. **Reviewer may post to GitHub** allows posts on that pull request only; **Reviewer may approve** needs it, never merges. Its instructions decide.

**Next:** [Read a pull request review](review-pull-requests.md)
