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
2. Read the sections, from the top:
   - **Needs attention**: flagged, and each row says why, for example "PR #12 changes requested".
   - **Working on**: a linked chat is running or finished, or the ticket is in progress.
   - **PR ready**: a pull request from Ship waits for your next move.
   - **In review**: in review in your tracker, or its PR waits on reviewers.
   - **Up next**: assigned to you and not started, by priority, then due date.
   - **Done recently**: done in the last 7 days.

![The Tickets inbox sorted into sections](images/tickets-inbox-light.png)

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

The ticket's row then shows the PR. If [PR follow-up](pr-follow-up.md) needs you, the ticket shows "PR #12 feedback needs you" under **Needs attention**.

## What needs you today

**Home** lists **What needs you today**: cards waiting in your chats, and flagged tickets and pull requests. The same brief shows at the top of the **Tickets** page.

> **Tip:** Use **Open chat** on a ticket's row to jump straight back to the chat that's working on it.

**Next:** [The Map](map.md)
