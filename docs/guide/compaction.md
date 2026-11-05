---
title: Manage a long chat
section: Chats
type: how-to
order: 224
summary: Watch the context ring, choose when Spark compacts a long chat, and read the summary it leaves behind.
---

Keep a long chat inside the model's context. About 2 minutes.

When a chat's context is nearly full, Spark compacts it: the agent carries on from a summary; your transcript stays.

## Check how full the chat is

1. Past half full, **N% context** shows under the box: amber at 60%, red at 80% by default.
2. Select it for the numbers and how long the **Prompt cache** stays warm.

![The context ring open, warning that the chat is getting full](images/compaction-ring-light.png)

Past the red point, Spark compacts before your next message, never mid-reply or while a card waits.

## Read the summary

1. Find the **Compacted** divider.
2. Select **View summary** to read what the agent now carries.

It ends with **Exact identifiers**: PR numbers, commits, branches, files, tickets, errors and links, never secrets. Agents read earlier turns with `spark_chat_history`.

## Change when Spark compacts

1. Open **Settings → Chats & autonomy** and find **Context compaction**.
2. Set **Warn when context is** (30% to 90%). It only colours the ring.
3. Set **Compact automatically at** (40% to 95%), or switch it off.

## Answer the card

With auto-compaction off, **This chat is almost full** asks first.

![The This chat is almost full card with its three choices](images/compaction-card-light.png)

| Choice                                | Result                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| **Compact now**                       | Carries on in this chat from a summary.                   |
| **Start a fresh chat with a summary** | A linked new chat, "… (continued)", gets your message.    |
| **Keep going**                        | Sends as is; the card returns 10 points later, up to 95%. |

**Next:** [Open a terminal](terminals.md)
