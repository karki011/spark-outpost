---
title: Connect GitHub and ticket trackers
section: Projects and shipping
type: how-to
order: 330
summary: Connect GitHub so Spark can open pull requests, connect Atlassian (Jira, Confluence), Linear or ServiceNow, and keep tickets in step with pull requests.
---

Each connection is optional. About 3 minutes.

## Connect GitHub

1. Open **Settings → Connectors** and select **GitHub**.
2. For **GitHub sign-in**, select **Sign in with GitHub**, then **Open GitHub**, and enter the code shown (only in builds set up for it).
3. For **gh CLI**, run `gh auth login`, then select **Check again**.
4. For **Personal token**, paste it into **Personal access token** and select **Verify token**, adding any **Enterprise host**.
5. Select **Test** to check each project's remote and sign-in, changing nothing.

Sign-in reaches only repositories you pick. A project marked **not covered** shows **Give Spark access to this repo**.

Access renews itself; if it ends, select **Sign in again**. Sign-in needs github.com, not Enterprise.

![The GitHub card in Settings → Connectors](images/tickets-github-light.png)

## Connect a ticket tracker

1. Open **Settings → Connectors** and select **Atlassian**, **Linear** or **ServiceNow**.
2. Atlassian: **Site URL**, **Email**, **API token**. Linear: **API key**. ServiceNow: **Instance** (`acme`), then a **Username** with a **Password** or **API key**; with SSO, ask your admin for a key.
3. Select **Save and check**.

Each product or record type has a switch and says when out of reach.

Keys stay in your keychain. To stop, select **Disconnect** (or **···** → **Disconnect…**). ServiceNow's **···** also has **Check connection** and **Open instance**.

## Keep tickets in sync with pull requests

Linear and Atlassian **Jira tickets** have two switches, on by default: **Move tickets to In review when a PR opens** and **Move tickets to Done when the PR merges**.

Each switch, and **Start work**, has a picker of your projects' statuses. **Automatic** uses the status named Done, In Review or In Progress, or the only fit; never Rejected, Cancelled or Duplicate.

When several fit, Spark flags the ticket. It always adds the PR link, never a comment.

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
