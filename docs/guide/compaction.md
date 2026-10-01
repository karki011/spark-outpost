---
title: Long chats and compaction
section: Work with Spark
order: 260
summary: Watch the context ring, choose when Spark compacts a long chat, and read the summary it leaves behind.
---

You'll learn how Spark keeps a long chat inside the model's context, and how to control it. About 3 minutes.

Every model can hold only so much of a conversation at once: its context. When a chat gets close to full, Spark compacts it: the agent carries on from a summary instead of the whole history. Your full transcript always stays in the chat.

## Watch the context ring

The round context ring sits in the message box, next to the model button. It shows how full the agent's context was after the last reply.

1. Glance at the ring. It turns amber at the warning point (60% by default) and red at the compaction point (80% by default).
2. Select it to see the numbers, for example "150K of 200K tokens (75%)", and what Spark does next.

![The context ring open, warning that the chat is getting full](images/compaction-ring-light.png)

Spark checks only between your messages, never in the middle of a reply, and never while an approval card waits.

## What happens at the compaction point

When you send a message and the chat is past the compaction point, what Spark does depends on the chat's [Spark autonomy](chats-and-modes.md#spark-autonomy):

- **Review each step**: a card asks first. See [Answer the card](#answer-the-card).
- **Automatic** and **Full auto → PR**: Spark compacts before your message and notes it in the work log, for example "Sent /compact to the agent".

Spark first asks the agent to compact itself with `/compact`. If the agent can't, or its context barely shrinks, Spark writes the summary itself from the transcript.

## Answer the card

The card **This chat is almost full** asks "Compact it before your message?" and shows how full the context is.

![The This chat is almost full card with its three choices](images/compaction-card-light.png)

1. Pick one:
   - **Compact now**: the agent carries on in this chat from a summary.
   - **Start a fresh chat with a summary**: Spark opens a new chat in the same projects with the same settings, titled "… (continued)", and sends your message there.
   - **Keep going**: send as is. The card comes back 10 points later, at most at 95%.
2. If you don't answer and **If you don't answer a question** in **Settings → Spark** has a time set, Spark picks **Keep going** after that time.

A fresh chat and the old one link to each other: **Open the fresh chat** in the old one, **Open the earlier chat** in the new one.

## Read the summary

After a compaction, a divider sits above your message, for example "Compacted · 180K → 16K tokens". The second number is what the agent's context holds on the next reply, system prompt and tools included, so it shows once that reply ends. A summary Spark wrote says **Compacted with a Spark summary**.

1. Select **View summary** on the divider to read what the agent now carries.
2. Select **Hide summary** to fold it away.

![The Compacted divider with the summary open](images/compaction-divider-light.png)

Claude Code and Codex also compact on their own. When that happens, the divider says **The agent compacted its context**.

## Change when Spark compacts

1. Open **Settings → Spark** and find **Context compaction**.
2. Change **Warn when context is** (default 60%, from 30% to 90%). This only colours the ring.
3. Change **Compact automatically at** (default 80%, from 40% to 95%). The warning must be at least 5 points lower.
4. To stop Spark compacting by itself, turn off the **Compact automatically at** switch. Spark then only warns and shows the card at that point, at every autonomy level.

![The Context compaction settings](images/compaction-settings-light.png)

Changes apply to every chat from its next reply.

> **Tip:** Nothing is lost when a chat compacts. Agents can still look up earlier turns with the `spark_chat_history` tool, and you can scroll back as usual.
