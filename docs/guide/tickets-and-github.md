---
title: Tickets and GitHub
section: Your tools
order: 410
summary: Connect GitHub so Spark can open pull requests, connect Jira or Linear to bring in your tickets, and keep tickets in step with pull requests.
---

You'll connect GitHub and your ticket tracker, and choose how tickets follow your pull requests. About 3 minutes.

All of this lives in **Settings → Connectors**. Every connection is optional.

## Connect GitHub

GitHub lets Ship open pull requests and lets Spark follow up on them. Committing and pushing work without it.

1. Open **Settings → Connectors** and select the **GitHub** card.
2. Pick how to connect:
   - **gh CLI**: if you already use `gh`. If it says "Installed but not signed in.", run `gh auth login` in a terminal, then select **Check again**.
   - **Personal token**: paste a token into **Personal access token**, add an **Enterprise host** if you use one, and select **Verify token**.
3. Check the status, for example "Connected through the gh CLI as maya".

![The GitHub card in Settings → Connectors](images/tickets-github-light.png)

A token is stored in your system keychain. To remove it, select **Remove token**.

## Connect Jira or Linear

1. Open **Settings → Connectors** and select **Jira** or **Linear**.
2. Fill in the form:
   - **Jira**: your **Site URL**, **Email** and an **API token**. Use **Create an API token** if you need one.
   - **Linear**: an **API key**. Create a personal API key in Linear under Settings → Security & access.
3. Select **Save and check**. The card says **Connected!** and then "Connected to … as …".

Keys stay in your system keychain and are never shown again. To stop, select **Disconnect**. You can also connect from the **Tickets** page when it's empty.

## Keep tickets in sync with pull requests

Each connected Jira or Linear card has two switches, both on by default:

- **Move tickets to In review when a PR opens**: when Ship opens a PR for a linked ticket, Spark moves the ticket to In review.
- **Move tickets to Done when the PR merges**: Spark checks merged PRs when it refreshes your tickets.

Spark always adds the PR link to the ticket, even with the first switch off. It never posts comments on your tickets.

> **Tip:** Start work from a ticket, not a blank chat, so Spark links them for you. See [Work from the Tickets inbox](tickets-inbox.md).

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
