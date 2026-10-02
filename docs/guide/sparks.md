---
title: Sparks, your named teammates
section: Work with Spark
order: 216
summary: Make named teammates with a face, a role, their own chat, defaults and standing instructions, then talk to one from Home or a new chat.
---

You'll make a Spark, open its chat and start other chats with it. About 2 minutes.

A Spark is a named teammate, like a contact. It has a blob face, a role, one long-running **home chat**, defaults for new chats and **standing instructions** that it follows in every chat.

## Make a Spark

1. Open **Home**. Your Sparks sit under **Your Sparks**.
2. Select **New Spark**. If you have none yet, you can select **Add** on a suggested Spark instead, such as **Pip · Code reviewer**. Nothing is made until you select it.
3. Type a **Name** and a **Role**, for example **Ada** and **Release manager**.
4. Pick a **Blob** and a **Colour**. Until you pick, the face follows the name.
5. Under **Defaults for its chats**, pick the **Provider**, **Model**, **Mode**, **Spark autonomy** and **Default project**. Leave any of them on its default to use your usual settings.
6. Write **Standing instructions**, up to 2,000 characters.
7. Select **Create Spark**.

> **Tip:** Write standing instructions the way you'd brief a person: what to focus on, what to avoid, and how to report back.

## Open a Spark's chat

Select a Spark's card on **Home**. Its home chat opens, named after the Spark, with its face in the chat header.

The card shows what the Spark is doing across all its chats:

| State         | What it means                                  |
| ------------- | ---------------------------------------------- |
| **Working**   | A request in one of its chats is running.      |
| **Needs you** | A card in one of its chats is waiting for you. |
| **Done**      | Its latest request finished in the last hour.  |
| **Failed**    | Its latest request failed in the last day.     |
| _No state_    | Idle. The card shows its latest chat and when. |

## Start another chat with a Spark

1. On **Home**, or in a new chat, select **Talk to…** above the message box.
2. Pick a Spark. The chip changes to **Talking to** and the Spark's name.
3. Send your message.

The chat starts with that Spark's defaults. To go back to a plain chat before you send, pick **No Spark**. You can pick a Spark only before the first message.

## Find a Spark's chats

Chats with a Spark show its face in the **Chats** list. To see only one Spark's chats, select its name under the search box, or type **with:** and the name, for example `with:ada`. Select the name again to see all chats.

## What a Spark changes, and what it doesn't

- Standing instructions are added to the agent's instructions in every chat with that Spark, marked as yours. They are not treated as tool output or file content.
- The chat's main agent uses the Spark's provider and model. When Spark brings in a crew, Builders are still picked the usual way.
- Defaults apply when a chat starts. Changing a Spark later doesn't change chats that already started, but new instructions reach its chats from their next message.
- Approvals, protected paths and every other safety rule work the same as in any chat.

## Change or delete a Spark

1. On **Home**, point at a Spark's card and select **Edit**. You can also open **Settings** → **Sparks**.
2. Change what you need and select **Save**.

To delete a Spark, open **Edit**, then press and hold **Hold to delete** for 1.5 seconds. You get 10 seconds to select **Undo**. Its chats stay; they just lose the link to the Spark.

Agents in your chats can list your Sparks and suggest a new one or a change, which you confirm on a card. See [Spark tools for agents](spark-tools.md).

**Next:** [The Spark crew](spark-crew.md)
