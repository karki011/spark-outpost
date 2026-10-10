---
title: Manage providers, models and Jev
section: Mac app and providers
type: how-to
order: 418
summary: Change a provider's defaults, sign in again or disconnect it, read the model cards, and connect Jev, the optional advisor.
---

You'll change a provider's defaults, reconnect it, read the model cards and connect Jev. About 2 minutes.

## Change defaults or the default provider

1. Open **Settings → AI providers** and select the provider's tile.
2. Under **Defaults for new chats**, change **Model**, **Mode** or **Effort**.
3. Select **Make default** to start new chats with this provider.

![Defaults for new chats on the Claude screen](images/providers-defaults-light.png)

**How to connect** shows the **Account** and usable **Models**. If the default isn't usable, select **Switch to …**.

Changes apply to new chats; **Model** only to chats off **Auto**. **Per chat** effort keeps each chat's own.

## Sign in again, switch or disconnect

1. On the provider's screen, find **How to connect**.
2. Select **Sign in again**, **Use an API key instead** or **Use a new key**.
3. To disconnect, hold **Hold to disconnect** or **Hold to remove the key** under **Danger zone**. You get 10 seconds to **Undo**.

## Read the model cards

1. Open **Settings → Models** and pick a provider, or **All**.
2. Select a model's row for its price, effort levels, **Good at**, **Watch out for** and sources.

![Settings → Models with one row per model](images/providers-model-cards-light.png)

| Group                      | Spark uses it for            |
| -------------------------- | ---------------------------- |
| **Spark picks from these** | The job named on each row    |
| **Only when you pick it**  | Nothing, unless you pin it   |
| **No card yet**            | Its tier comes from its name |

## Connect Jev

[Jev](jev.md) is an optional advisor from TypeSafe. Without it, Spark's own rules do the same jobs.

1. Get an API key from the **TypeSafe console**.
2. In **Settings → AI providers**, select the **Jev** tile under **Advisor**.
3. Paste the key and verify it. Verifying is free, and the key goes to your system keychain.

To remove Jev, hold **Hold to remove the Jev key** under **Danger zone**.

**Next:** [How Spark works](how-spark-works.md)
