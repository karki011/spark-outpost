---
title: Keep keys out of chats
section: Providers and keys
type: how-to
order: 752
summary: Paste API keys only in the key field, and choose what to do when Spark warns that a message has a secret in it.
---

You'll keep API keys in the keychain and out of chat messages. About 1 minute.

Chat text is sent to the agent's provider and saved with the chat. A key belongs in the key field only.

## Add a key the safe way

1. Open **Settings → AI providers** and select the provider's tile.
2. On the **API key** tab, paste the key into the key field.
3. Select **Verify key**.

## If Spark warns about a message

When a message looks like it has a secret in it, Spark holds it and shows "Paste API keys in Settings → AI providers instead."

1. Press **Enter** to pick **Remove it**. Each secret becomes `[removed]` so you can review and send.
2. Or select **Send anyway** to send the message as written.
3. Or press **Esc** to edit the message yourself.

The warning shows in a chat, on Home, and in Spark Island's **Quick chat** and **Ask**.

| Spark checks for    | Examples                                                             |
| ------------------- | -------------------------------------------------------------------- |
| API keys and tokens | `sk-ant-…`, `sk-…`, `ghp_…`, `github_pat_…`, `AKIA…`, `xoxb-…`, JWTs |
| Private key blocks  | `-----BEGIN … PRIVATE KEY-----`                                      |
| `KEY=value` lines   | A secret-looking name with a long random value                       |

If you send anyway, the provider and the saved chat get the message as written. The audit log stores it with the secret redacted.

> **Tip:** To check what Spark stored, open Keychain Access and search for **Spark Outpost**.

**Next:** [Spark at a glance](how-spark-works.md)
