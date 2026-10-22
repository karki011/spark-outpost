---
title: Statuses and limits
section: Reference
type: reference
order: 622
summary: What each status label means across providers, chats, Sparks, tickets, the Map and Spark Island, and the fixed limits.
---

## Provider tiles

| Status                                  | Means                              |
| --------------------------------------- | ---------------------------------- |
| **Not set up**                          | Nothing connected yet.             |
| **CLI not installed**                   | Install `claude` or `codex` first. |
| **Needs sign-in**                       | Sign in to the CLI.                |
| **Connected · Local CLI** / **API key** | Ready.                             |
| **Error**                               | **Test** says what's wrong.        |

## Chat list

A dot shows changes since you last opened the chat; point at it.

| Dot                         | Means                                                |
| --------------------------- | ---------------------------------------------------- |
| **Working**: a pulsing ring | A turn, background agents or a Terminal session run. |
| **Waiting for you**: amber  | A card, a question or a Terminal session waits.      |
| **Done**: green             | A turn finished.                                     |
| **Couldn't finish**: red    | A turn failed or was interrupted.                    |

## To-do

| Mark         | Means                                      |
| ------------ | ------------------------------------------ |
| A tick       | Done.                                      |
| A spinner    | What the agent is on now.                  |
| An open ring | Not started; after the turn, not finished. |

## Chats and Sparks

| Status                | Where      | Means                                                                  |
| --------------------- | ---------- | ---------------------------------------------------------------------- |
| **Flagged by Spark**  | Chat list  | An unreviewed action crossed a protected path; it never counts.        |
| **Working**           | Spark card | A request in one of its chats is running.                              |
| **Needs you**         | Spark card | A card in one of its chats waits.                                      |
| **Done** / **Failed** | Spark card | Its latest request finished in the last hour / failed in the last day. |

## Outpost requests

| Status        | Means                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| **Sent**      | The chat is busy, failed or stopped, something is paused, or it reads **Waiting for @api**. |
| **Working**   | Its turn runs; the line below says what it's doing.                                         |
| **Needs you** | An approval card waits, or the reply ends **Needs you: …**.                                 |
| **Answered**  | The answer is under the request.                                                            |
| **Failed**    | The turn failed, saying why, or **Not delivered: …**.                                       |
| **Cancelled** | You cancelled it or stopped its turn.                                                       |

## Ticket groups

| Group                      | Holds                                         |
| -------------------------- | --------------------------------------------- |
| **Needs you**              | A linked chat waits, or a rule flagged it.    |
| **In progress with Spark** | A linked chat is running.                     |
| **Started**                | In progress in your tracker, no chat running. |
| **Up next**                | Assigned to you and not started.              |
| **In review / PR open**    | Either, with a checks badge.                  |
| **Done recently**          | Done, or its PR merged, in the last 7 days.   |

## Map status

| Status             | Means                                 |
| ------------------ | ------------------------------------- |
| **Updated** _time_ | Up to date.                           |
| **Waiting**        | The build hasn't started.             |
| **Paused**         | Agents are running; it resumes after. |
| **Map failed**     | Point at it for why.                  |

## Spark Island states

| You see                          | Means                                                       |
| -------------------------------- | ----------------------------------------------------------- |
| Scout's eyes scan                | **Working…**                                                |
| An amber count beside Scout      | **Needs you**                                               |
| A dashed count on Scout          | Set aside                                                   |
| A happy face                     | **Done**                                                    |
| A worried face                   | **Failed**                                                  |
| Scout alone                      | **Quiet**                                                   |
| **Terminal session** on the card | Answer in **Open terminal**. The card never shows commands. |

With **Reduce motion** on, only faces change.

## Prompt cache

Idle Claude chats and Terminal sessions show it, never during a turn, sub-agent or card.

| Shows                                                         | Means                                          |
| ------------------------------------------------------------- | ---------------------------------------------- |
| **Cache warm · 42 min left**                                  | Time left in the lifetime the last write used. |
| **Cache cold · next message re-writes ~182K tokens (~$3.64)** | About tokens × the cache-write price.          |
| **Cache last used 12 min ago**                                | Lifetime unknown.                              |
| **This turn re-wrote …**                                      | Half the last context or more, re-written.     |
| **Cache hit** in **Cost**                                     | Cache reads ÷ all input tokens.                |

## Limits

Spark caps no time, tool calls or cost for a turn. A ring above **Pause** shows Claude plan use and resets once a window reaches 70%.

| Limit                                | Value                                    |
| ------------------------------------ | ---------------------------------------- |
| Approval card expiry                 | 30 minutes                               |
| PR follow-up rounds per PR           | 3                                        |
| Terminals open across all chats      | 12, each keeping 5,000 lines             |
| Chats in an outpost                  | 50                                       |
| Standing instructions for a Spark    | 2,000 characters                         |
| Diff shown before **Load full file** | 2,000 lines; files over 1 MB stay folded |
| Hold-to-confirm                      | 1.5 seconds; undo window 10 seconds      |
| App logs kept                        | About 8 MB                               |
