---
title: Work from the Tickets inbox
section: Tickets and GitHub
type: how-to
order: 612
summary: Find what needs you in the Tickets inbox, start a chat from a ticket, and follow it through to a pull request.
---

You'll find your tickets in Spark and turn one into a chat. About 2 minutes.

First [connect Jira or Linear](tickets-and-github.md#connect-jira-or-linear).

## Find your tickets

1. Select **Tickets** in the rail.
2. Read the groups, most urgent first. See [Ticket groups](statuses-and-limits.md#ticket-groups).
3. Select a count in the strip at the top, such as "3 need you", to show only that group.
4. Narrow with **Source**, **Team or project** and **Assignee**, or search.

![The Tickets inbox grouped by where each ticket is](images/tickets-inbox-light.png)

Groups update as chats and pull requests change. Snooze a ticket to hide it until later.

## Start a chat from a ticket

1. Select **Start** on the ticket's row.
2. Under **How to start**, pick **Plan first** or **Build**.
3. Pick the **Project folder**.
4. Leave **Move** _KEY_ **to In progress** on to update your tracker.
5. Optionally open **Add context** for a **Note**, **Add link**, **Add files** or **Add folder**.
6. Select **Start with a plan** or **Start building**.

![Start work on a ticket, with Plan first selected](images/tickets-start-light.png)

The chat starts with a short brief: the ticket's key, title, status, link and acceptance criteria. The agent reads the rest from your tracker when it needs it.

Spark treats ticket text as data, never as instructions. For a link, Spark sends the address and doesn't fetch the page. For a folder, it sends the path, never the contents. Secret files are refused.

## Follow it to a pull request

When you ship the chat's work, Spark adds the PR link to the ticket and moves it along if you allow it. The row then shows the PR, such as "PR #341 · checks passing".

> **Tip:** Select **Open chat** on a ticket's row to jump back to the chat working on it.

**Next:** [Set up Spark Island](desktop-companion.md)
