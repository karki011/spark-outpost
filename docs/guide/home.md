---
title: Read Home
section: Chats
type: reference
order: 211
summary: Home keeps one layout all day: a headline, a lead card when something needs your attention, the composer and a three-column board.
---

Home has four parts in the same order: a one-sentence headline beside Scout and the time, a **lead card** (or none), the composer, and a three-column board.

The board stacks into one column on narrow windows and phones.

## The lead card

Only one lead shows. Spark picks it from what is true now, in this order.

| Lead               | Shows when                                                                                                                                  | What it lists                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Your meeting       | A calendar meeting is inside its **Join opens** time, or started under 5 minutes ago. Mac app only.                                         | **Dismiss**, **Snooze 1 min** and **Join**; **Will stall without you** cards; **Still working** chats, each with its agent mode.            |
| **Since you left** | You were away from Home at least 30 minutes, with unread failed, finished or clean pull request updates that arrived since you last looked. | Up to five rows, failed first, then waiting cards, clean pull requests and finished turns, each with one action. **N more** opens the next. |
| **Before you go**  | It is 17:00 to 04:00 and a chat is running or waiting.                                                                                      | **Waiting on you** cards, then running chats grouped as **Will stop and ask** and **Runs without asking**.                                  |
| None               | Nothing above applies.                                                                                                                      | The composer leads.                                                                                                                         |

A waiting row for an ordinary command or file card also has **Allow** (once) and **Deny**. The row leaves at once and comes back with the reason if Spark refuses.

Hold-to-confirm cards, instruction files, changes shown before and after, questions, plans and Mac-only cards keep only **Open chat** or **Answer**.

Spark remembers when you last looked at Home on its server, so a reload or another device gives the same answer. It records the visit after you have looked for 5 seconds.

Opening a row marks its update read, so it leaves the list. Updates that arrive while Home is open go to the board.

## The board

| Column        | Shows                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Needs you** | Cards and errors the lead does not show. With none, it becomes **Pick up next**: the morning brief's entries, its **Refresh**, and the **Connect** hint for Linear or Jira.                                                          |
| **Working**   | Running chats with step and plan progress, **Ready for you to review** (clean pull requests and unread finished chats), and a **Sparks** line that opens your Sparks.                                                                |
| **Your day**  | Today's meetings with **Join**, or **After the meeting** during a meeting. Without a calendar, or on a phone, the week recap takes its place. Below: today's spend with **Usage**, and a provider that needs attention with **Fix**. |

**Recent chats** below the board opens the chat list.

The headline follows your **Personality** in [Settings](settings.md). Home never starts work on its own; every action opens a chat.
