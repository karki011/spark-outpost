---
title: Connect GitHub, Jira or Linear
section: Projects and shipping
type: how-to
order: 330
summary: Connect GitHub so Spark can open pull requests, connect Jira or Linear to bring in tickets, and keep tickets in step with pull requests.
---

You'll connect GitHub and your ticket tracker. About 3 minutes.

Every connection is optional. Committing and pushing work without GitHub connected.

## Connect GitHub

1. Open **Settings → Connectors** and select the **GitHub** card.
2. For **gh CLI**, run `gh auth login` in a terminal, then select **Check again**.
3. For **Personal token**, paste it into **Personal access token** and select **Verify token**. Add an **Enterprise host** if you use one.
4. Select **Test** to check each project's remote and sign-in without changing anything.

![The GitHub card in Settings → Connectors](images/tickets-github-light.png)

## Connect Jira or Linear

1. Open **Settings → Connectors** and select **Jira** or **Linear**.
2. For Jira, enter the **Site URL**, **Email** and an **API token**. For Linear, enter an **API key**.
3. Select **Save and check**.

Keys and tokens are stored in your system keychain and never shown again. To stop, select **Disconnect** or **Remove token**.

## Keep tickets in sync with pull requests

Each connected Jira or Linear card has two switches, both on by default:

| Switch                                        | Does                                            |
| --------------------------------------------- | ----------------------------------------------- |
| **Move tickets to In review when a PR opens** | Moves the linked ticket when Ship opens its PR. |
| **Move tickets to Done when the PR merges**   | Moves it when Spark sees the PR merged.         |

Spark always adds the PR link to the ticket. The sync never posts comments on your tickets.

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
