---
title: Work from the Tickets inbox
section: Your tools
order: 415
summary: Find what needs you in the Tickets inbox, start a chat from a ticket, and follow it through to a pull request.
---

You'll find your tickets in Spark and turn one into a chat. About 2 minutes.

First connect Jira or Linear. See [Tickets and GitHub](tickets-and-github.md#connect-jira-or-linear).

## Find your tickets

1. Select **Tickets** in the rail.
2. Read the groups, most urgent first. Each ticket is in one group, from your tracker's status and what Spark is doing on it:
   - **Needs you**: a linked chat waits on you (for example to approve a plan), checks fail on its PR, or a rule flagged it. The row says why.
   - **In progress with Spark**: a linked chat is running. The row shows the Spark working on it and its plan progress, such as "8/10 · Pip working".
   - **Started**: in progress in your tracker, or a chat worked on it, and no chat is running now.
   - **Up next**: assigned to you and not started, by priority, then due date.
   - **In review / PR open**: in review in your tracker, or its PR is open, such as "PR #341 · checks passing".
   - **Done recently**: done, or its PR merged, in the last 7 days.

![The Tickets inbox grouped by where each ticket is](images/tickets-inbox-light.png)

Each row has a status chip with its own colour and icon, the Spark progress or the reason, priority, age and who it's assigned to. Hover or focus a row for a short preview, and select it to open the details. Groups update as chats and PRs change; you don't need to refresh.

The strip at the top counts each group, such as "3 need you · 2 with Spark · 4 done this week". Select a count to show only that group, and select it again to show all.

On the keyboard, Up and Down (or J and K) move between rows, Home and End jump to the first and last, and Enter opens one. With the details open, moving between rows follows along.

Use the filters for **Source**, **Team or project** and **Assignee**, or search all tickets. Snooze a ticket to hide it until later; it comes back sooner if something new needs you.

## Start a chat from a ticket

1. Select **Start** on a ticket's row.
2. Under **How to start**, pick **Plan first** or **Build**.
3. Pick the **Project folder** for the work.
4. Leave **Move** _KEY_ **to In progress** on to update your tracker. For a ticket that isn't yours, you can also assign it to yourself.
5. Select **Start with a plan** or **Start building**.

![Start work on a ticket, with Plan first selected](images/tickets-start-light.png)

The new chat starts with the ticket's title, description, acceptance criteria and subtasks, and the ticket links to the chat. Spark treats the ticket text as data, never as instructions.

## Follow a ticket to a pull request

When you ship the chat's work as a PR, Spark adds the PR link to the ticket and, if you allow it, moves the ticket along. See [Keep tickets in sync with pull requests](tickets-and-github.md#keep-tickets-in-sync-with-pull-requests).

The ticket's row then shows the PR. If [PR follow-up](pr-follow-up.md) needs you, the ticket shows "PR #12 feedback needs you" under **Needs you**.

## What needs you today

**Home** lists **What needs you today**: cards waiting in your chats, and flagged tickets and pull requests. The same brief shows at the top of the **Tickets** page.

> **Tip:** Use **Open chat** on a ticket's row to jump straight back to the chat that's working on it.

**Next:** [The Map](map.md)
