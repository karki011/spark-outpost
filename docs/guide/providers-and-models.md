---
title: Manage providers and models
section: Providers and keys
type: how-to
order: 750
summary: Change a provider's defaults, make it the default, sign in again or disconnect it, and read the model cards.
---

You'll manage connected providers after setup. About 2 minutes.

To connect one for the first time, see [Connect an AI provider](connect-a-provider.md).

## Change defaults or the default provider

1. Open **Settings → AI providers** and select the provider's tile.
2. Open **Defaults for new chats** and change **Model**, **Mode** or **Effort**.
3. To start new chats with this provider, select **Make default**.

![Defaults for new chats on the Claude screen](images/providers-defaults-light.png)

Changes apply to new chats. A fixed **Effort** also applies to every Builder; **Per chat** lets each chat keep its own.

## Sign in again, switch or disconnect

1. Open the provider's screen.
2. Under **How to connect**, select **Sign in again**, **Use an API key instead** or **Use a new key**.
3. To disconnect, hold **Hold to disconnect** or **Hold to remove the key** under **Danger zone**. You get 10 seconds to **Undo**.

To check a connection, select **Send test message** under **Test**.

## Read the model cards

1. Open **Settings → Models** and pick a provider, or **All**.
2. Read each card: its cost, how it did on Spark's benchmark, and when Spark uses it.
3. Select **Details** for effort levels, **Good at**, **Watch out for** and sources.

![Settings → Models with the model cards](images/providers-model-cards-light.png)

| Card says                 | Spark uses it for                 |
| ------------------------- | --------------------------------- |
| **mid tier**              | Everyday Builder, Critic, answers |
| **top tier**              | Complex and risky work            |
| **Only when you pick it** | Nothing, unless you pin it        |

Spark never runs a Builder on a small, fast model. It raises the Builder to the next model up and says so.

Claude Opus 5.5 and Sonnet 5 start on their 1M-token window. If your account runs a smaller window, a one-line note says which one the chat got.

**Next:** [Keep keys out of chats](protect-secrets.md)
