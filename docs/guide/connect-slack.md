---
title: Connect Slack
section: Projects and shipping
type: how-to
order: 331
summary: Create your own Slack app from Spark's manifest, paste its tokens, pick the channels and direct messages Spark may use, and see what Spark reads, stores and sends.
---

You'll connect Slack with an app only you control. About 5 minutes.

## Connect

1. Open **Settings → Connectors → Slack** and select **Copy manifest**.
2. Select **Create a Slack app**, choose **From a manifest**, pick your workspace and paste.
3. Install the app, then paste the tokens. Only the **Bot token** is required.
4. Select **Save and check**.
5. Under **Allowed channels**, tick each channel Spark may use. In Slack, type `/invite @Spark` in each.

| Token                       | Where in Slack                             | Adds                                                             |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| **Bot token** `xoxb-`       | **OAuth & Permissions**                    | Notifications, shared threads, posts                             |
| **User token** `xoxp-`      | **OAuth & Permissions**                    | Search, channels the app hasn't joined, direct messages you pick |
| **App-level token** `xapp-` | **Basic Information**, `connections:write` | **Start work in Spark** shortcut and @mentions, over Socket Mode |

Paste tokens only in Settings, never in a chat.

## Use it

| To             | Do                                                                             |
| -------------- | ------------------------------------------------------------------------------ |
| Get notified   | Pick events under **Notify me in Slack**. Each message links back to the chat. |
| Share a thread | Paste a Slack message link into the message box. It becomes an attachment.     |
| Read your DMs  | Turn on **Let Spark read my direct messages**, then tick conversations.        |
| Start work     | Use the shortcut in Slack, or **Start work from a Slack link** on the card.    |
| Post an update | Ask the agent. A [card](spark-tools.md#when-actions-ask-first) shows the text. |

## What Spark reads, stores and sends

| Data              | Handling                                                                              |
| ----------------- | ------------------------------------------------------------------------------------- |
| Threads you share | Fetched on demand, capped, secrets redacted, kept as that chat's attachment.          |
| Other messages    | Never read. Search results outside what you allowed are dropped.                      |
| Direct messages   | Off until you switch it on. Only ticked ones, read as you. Never posted in.           |
| Thread text       | Treated as someone else's words, never as instructions. Reading it makes actions ask. |
| Notifications     | Chat title, project, event and link. Never code, diffs or commands.                   |
| Jev               | Gets nothing extra from Slack.                                                        |
| Tokens            | Your keychain only. **Disconnect** removes them.                                      |

**Next:** [Work from the Tickets inbox](tickets-inbox.md)
