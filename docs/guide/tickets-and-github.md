---
title: Connect GitHub and ticket trackers
section: Projects and shipping
type: how-to
order: 330
summary: Connect GitHub so Spark can open pull requests, connect Atlassian (Jira, Confluence), Linear or ServiceNow, and keep tickets in step with pull requests.
---

Each connection is optional. About 3 minutes.

## Connect GitHub

1. Open **Settings → Connectors** and select the **GitHub** card.
2. For **GitHub sign-in**, select **Sign in with GitHub**, then **Open GitHub**, and enter the code shown. Only builds set up for it offer this.
3. For **gh CLI**, run `gh auth login` in a terminal, then select **Check again**.
4. For **Personal token**, paste it into **Personal access token** and select **Verify token**. Add an **Enterprise host** if you use one.
5. Select **Test** to check each project's remote and sign-in.

With sign-in, Spark reaches only the repositories you pick. A project marked **not covered** shows **Give Spark access to this repo**.

Access renews itself; if it ends, select **Sign in again**. Sign-in needs github.com, not an Enterprise server.

![The GitHub card in Settings → Connectors](images/tickets-github-light.png)

## Connect a ticket tracker

1. Open **Settings → Connectors** and select **Atlassian**, **Linear** or **ServiceNow**.
2. Atlassian: **Site URL**, **Email**, **API token**. Linear: **API key**. ServiceNow: **Instance** (`acme`), then a **Username** with a **Password** or **API key**; with SSO, ask your admin for a key.
3. Select **Save and check**.

Each product or record type has a switch (**Changes**: read only) and says when out of reach.

Keys stay in your keychain. To stop, select **Disconnect** (or **···** → **Disconnect…**). ServiceNow's **···** also has **Check connection** and **Open instance**.

## Keep tickets in sync with pull requests

Linear and **Jira tickets** on Atlassian have two switches, on by default: **Move tickets to In review when a PR opens** and **Move tickets to Done when the PR merges**.

Under each switch, and for **Start work**, a picker lists your projects' statuses. **Automatic** uses the status named Done, In Review or In Progress, or the only fit; never Rejected, Cancelled or Duplicate.

If several fit, Spark flags the ticket.

Spark always adds the PR link and never comments on tickets.

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
