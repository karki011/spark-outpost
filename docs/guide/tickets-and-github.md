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
2. For **GitHub sign-in**, select **Sign in with GitHub**, then **Open GitHub**, and enter the code shown. This option appears only in builds set up for it.
3. For **gh CLI**, run `gh auth login` in a terminal, then select **Check again**.
4. For **Personal token**, paste it into **Personal access token** and select **Verify token**. Add an **Enterprise host** if you use one.
5. Select **Test** to check each project's remote and sign-in without changing anything.

With sign-in, Spark reaches only the repositories you pick. A project marked **not covered** shows **Give Spark access to this repo**.

Access renews itself; if it ends, select **Sign in again**. Sign-in needs github.com, not an Enterprise server.

![The GitHub card in Settings → Connectors](images/tickets-github-light.png)

## Connect Jira or Linear

1. Open **Settings → Connectors** and select **Jira** or **Linear**.
2. For Jira, enter the **Site URL**, **Email** and an **API token**. For Linear, enter an **API key**.
3. Select **Save and check**.

Keys and tokens are stored in your system keychain and never shown again. To stop, select **Disconnect** or **Remove token**.

## Keep tickets in sync with pull requests

Each Jira or Linear card has two switches, on by default: **Move tickets to In review when a PR opens** and **Move tickets to Done when the PR merges**.

Under each switch, and for **Start work**, a picker lists your projects' statuses. **Automatic** uses the status named Done, In Review or In Progress, or the only fit; never Rejected, Cancelled or Duplicate.

When several fit, Spark flags the ticket in **Tickets** and leaves it. Pick the status, then move it yourself.

Spark always adds the PR link and never comments on tickets.

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
