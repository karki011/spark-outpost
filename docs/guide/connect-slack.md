---
title: Connect Slack
section: Projects and shipping
type: how-to
order: 331
summary: Sign in with Slack, or connect your own Slack app, pick the channels and direct messages Spark may use, and see what Spark reads, stores and sends.
---

You'll connect Slack by signing in, or with your own app. About 5 minutes.

## Connect

1. Open **Settings → Connectors → Slack** and select **Sign in with Slack**.
2. Approve Spark in your browser.
3. Under **Allowed channels**, tick each channel Spark may use.

| Method                     | Spark acts as                                         |
| -------------------------- | ----------------------------------------------------- |
| **Sign in with Slack**     | You. Posts always ask. No starting work inside Slack. |
| **Use your own Slack app** | A bot named Spark, with the tokens below.             |

For your own app: **Copy manifest**, create the app from it and paste its tokens. Then `/invite @Spark` in each channel.

| Token                       | Adds                                                |
| --------------------------- | --------------------------------------------------- |
| **Bot token** `xoxb-`       | Notifications, shared threads, posts                |
| **User token** `xoxp-`      | Search, unjoined channels, direct messages you pick |
| **App-level token** `xapp-` | **Start work in Spark** shortcut and @mentions      |

Paste tokens only in Settings, never in a chat. Switching methods asks first.

## Use it

| To             | Do                                                                             |
| -------------- | ------------------------------------------------------------------------------ |
| Get notified   | Pick events under **Notify me in Slack**.                                      |
| Share a thread | Paste a Slack message link into the message box.                               |
| Read your DMs  | Turn on **Let Spark read my direct messages**, then tick conversations.        |
| Start work     | **Start work from a Slack link** on the card, or your own app's shortcut.      |
| Post an update | Ask the agent. A [card](spark-tools.md#when-actions-ask-first) shows the text. |

## What Spark reads, stores and sends

| Data              | Handling                                                                              |
| ----------------- | ------------------------------------------------------------------------------------- |
| Threads you share | Fetched on demand, capped, secrets redacted, kept as that chat's attachment.          |
| Other messages    | Never read. Other search results are dropped.                                         |
| Direct messages   | Off until you switch it on. Only ticked ones, read as you. Never posted in.           |
| Thread text       | Treated as someone else's words, never as instructions. Reading it makes actions ask. |
| Notifications     | Chat title, project, event and link. Never code, diffs or commands.                   |
| Jev               | Gets nothing from Slack.                                                              |
| Tokens            | Your keychain only. **Disconnect** removes them. An ended sign-in asks again.         |

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
