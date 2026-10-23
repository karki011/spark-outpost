---
title: Statuses and limits
section: Reference
type: reference
order: 622
summary: What each status label means across providers, chats, Sparks, tickets, the Map and Spark Island, and the fixed limits.
---

## Provider tiles

| Status                                  | Means                        |
| --------------------------------------- | ---------------------------- |
| **Not set up**                          | Nothing connected.           |
| **CLI not installed**                   | Install `claude` or `codex`. |
| **Needs sign-in**                       | Sign in to the CLI.          |
| **Connected · Local CLI** / **API key** | Ready.                       |
| **Error**                               | **Test** says what's wrong.  |

## Chat list

A dot marks changes since your last visit; point at it.

| Dot                         | Means                                                |
| --------------------------- | ---------------------------------------------------- |
| **Working**: a pulsing ring | A turn, background agents or a Terminal session run. |
| **Waiting for you**: amber  | A card, question or Terminal session waits.          |
| **Done**: green             | A turn finished.                                     |
| **Couldn't finish**: red    | A turn failed or was interrupted.                    |

A row reading **Flagged by Spark**: an unreviewed action crossed a protected path; it never counts.

## Spark cards

| Status                | Means                                                              |
| --------------------- | ------------------------------------------------------------------ |
| **Working**           | A request in one of its chats runs.                                |
| **Needs you**         | A card in one of its chats waits.                                  |
| **Done** / **Failed** | Latest request finished in the last hour / failed in the last day. |

## Outpost requests

| Status                  | Means                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| **Queued**              | The chat is busy, failed, stopped or paused.                          |
| **Working**             | Its turn runs.                                                        |
| **Held**                | Shows **Waiting for @api** until it's answered.                       |
| **Waiting on you**      | An approval card waits, or the reply ends **Needs you: …**.           |
| **Failed**              | Turn failed, or **Not delivered: …**; listed with **Waiting on you**. |
| **Ready for review**    | Answered, pull request open.                                          |
| **Idle**                | Answered, no open pull request.                                       |
| **Done**, **Cancelled** | Pull request merged or closed, or you cancelled.                      |

## Ticket groups

| Group                      | Holds                                         |
| -------------------------- | --------------------------------------------- |
| **Needs you**              | A linked chat waits, or a rule flagged it.    |
| **In progress with Spark** | A linked chat runs.                           |
| **Started**                | In progress in your tracker, no chat running. |
| **Up next**                | Assigned to you, not started.                 |
| **In review / PR open**    | Either, with a checks badge.                  |
| **Done recently**          | Done or PR merged in the last 7 days.         |

## Map status

| Status             | Means                      |
| ------------------ | -------------------------- |
| **Updated** _time_ | Up to date.                |
| **Waiting**        | Build not started.         |
| **Paused**         | Agents run; resumes after. |
| **Map failed**     | Point at it for why.       |

## Spark Island states

| You see                          | Means                                           |
| -------------------------------- | ----------------------------------------------- |
| Scout's eyes scan                | **Working…**                                    |
| Amber count beside Scout         | **Needs you**                                   |
| Dashed count on Scout            | Set aside                                       |
| Happy face                       | **Done**                                        |
| Worried face                     | **Failed**                                      |
| Scout alone                      | **Quiet**                                       |
| **Terminal session** on the card | Answer in **Open terminal**; no commands shown. |

With **Reduce motion** on, only faces change.

## Prompt cache

Idle Claude chats and Terminal sessions show it, never during a turn, sub-agent or card.

| Shows                                                         | Means                                   |
| ------------------------------------------------------------- | --------------------------------------- |
| **Cache warm · 42 min left**                                  | Time left in the last write's lifetime. |
| **Cache cold · next message re-writes ~182K tokens (~$3.64)** | About tokens × cache-write price.       |
| **Cache last used 12 min ago**                                | Lifetime unknown.                       |
| **This turn re-wrote …**                                      | At least half the last context.         |
| **Cache hit** in **Cost**                                     | Cache reads ÷ all input tokens.         |

## Limits

Turns have no time, tool-call or cost cap. A ring above **Pause** shows Claude plan use and resets once a window reaches 70%.

| Limit                                | Value                                    |
| ------------------------------------ | ---------------------------------------- |
| Approval card expiry                 | 30 minutes                               |
| Follow-up rounds per PR              | 3                                        |
| Open terminals, all chats            | 12, 5,000 lines each                     |
| Chats in an outpost                  | 50                                       |
| A Spark's standing instructions      | 2,000 characters                         |
| Diff shown before **Load full file** | 2,000 lines; files over 1 MB stay folded |
| Hold-to-confirm                      | 1.5 seconds; undo window 10 seconds      |
| App logs kept                        | About 8 MB                               |
