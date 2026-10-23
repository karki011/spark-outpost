---
title: Connect GitHub, Atlassian or Linear
section: Projects and shipping
type: how-to
order: 330
summary: Connect GitHub so Spark can open pull requests, connect Atlassian (Jira, Confluence) or Linear, and keep tickets in step with pull requests.
---

You'll connect GitHub and your ticket tracker, each optional. About 3 minutes.

## Connect GitHub

1. Open **Settings → Connectors** and select **GitHub**.
2. For **GitHub sign-in**, select **Sign in with GitHub**, then **Open GitHub**, and enter the code shown (only in builds set up for it).
3. For **gh CLI**, run `gh auth login`, then select **Check again**.
4. For **Personal token**, paste it into **Personal access token** and select **Verify token**, adding any **Enterprise host**.
5. Select **Test** to check each project's remote and sign-in, changing nothing.

Sign-in reaches only repositories you pick. A project marked **not covered** shows **Give Spark access to this repo**.

Access renews itself; if it ends, select **Sign in again**. Sign-in needs github.com, not Enterprise.

![The GitHub card in Settings → Connectors](images/tickets-github-light.png)

## Connect Atlassian or Linear

1. Open **Settings → Connectors** and select **Atlassian** or **Linear**.
2. Enter the **Site URL**, **Email** and an **API token** for Atlassian, or an **API key** for Linear.
3. Select **Save and check**.

**Jira** and **Confluence** each get a switch; the card says when the token can't reach one.

Keys stay in your keychain, never shown again. To stop, pick **Disconnect** (Atlassian: **···** → **Disconnect…**).

## Keep tickets in sync with pull requests

Linear and Atlassian **Jira tickets** have two switches, on by default: **Move tickets to In review when a PR opens** and **Move tickets to Done when the PR merges**.

Each switch, and **Start work**, has a picker of your projects' statuses. **Automatic** uses the status named Done, In Review or In Progress, or the only fit; never Rejected, Cancelled or Duplicate.

When several fit, Spark flags the ticket. It always adds the PR link, never a comment.

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
