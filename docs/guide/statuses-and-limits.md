---
title: Statuses and limits
section: Reference
type: reference
order: 622
summary: What each status label means across providers, chats, Sparks, tickets, the Map and Spark Island, and the fixed limits.
---

## Provider tiles

| Status                                  | Means                                      |
| --------------------------------------- | ------------------------------------------ |
| **Not set up**                          | Nothing connected yet.                     |
| **CLI not installed**                   | Install `claude` or `codex` first.         |
| **Needs sign-in**                       | Sign in to the CLI.                        |
| **Connected · Local CLI** / **API key** | Ready.                                     |
| **Error**                               | Open the tile; **Test** says what's wrong. |

## Chats and Sparks

| Status                | Where             | Means                                                                  |
| --------------------- | ----------------- | ---------------------------------------------------------------------- |
| **Asking permission** | Chat list         | An approval card waits.                                                |
| **PR feedback**       | Chat list         | PR follow-up needs you.                                                |
| **Flagged by Spark**  | Chat list, island | An unreviewed action crossed a protected path.                         |
| **Working**           | Spark card        | A request in one of its chats is running.                              |
| **Needs you**         | Spark card        | A card in one of its chats waits.                                      |
| **Done** / **Failed** | Spark card        | Its latest request finished in the last hour / failed in the last day. |

## Outpost requests

| Status        | Means                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Sent**      | The chat is busy, its last turn failed or was stopped, the outpost is paused, or it reads **Waiting for @api**. |
| **Working**   | Its turn is running; the line under it says what the chat is doing.                                             |
| **Needs you** | An approval card waits, or the reply ends **Needs you: …**.                                                     |
| **Answered**  | The answer is under the request.                                                                                |
| **Failed**    | The turn failed and the line says why, or **Not delivered: …**.                                                 |
| **Cancelled** | You cancelled it or stopped its turn.                                                                           |

## Ticket groups

| Group                      | Holds                                              |
| -------------------------- | -------------------------------------------------- |
| **Needs you**              | A linked chat waits, or a rule flagged it.         |
| **In progress with Spark** | A linked chat is running.                          |
| **Started**                | In progress in your tracker, with no chat running. |
| **Up next**                | Assigned to you and not started.                   |
| **In review / PR open**    | In review, or its PR is open, with a checks badge. |
| **Done recently**          | Done, or its PR merged, in the last 7 days.        |

## Map status

| Status             | Means                                                 |
| ------------------ | ----------------------------------------------------- |
| **Updated** _time_ | Up to date.                                           |
| **Waiting**        | The build hasn't started.                             |
| **Paused**         | Agents are running. The map resumes when they finish. |
| **Map failed**     | Point at it to read why.                              |

## Spark Island states

| You see                                           | Means                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scout's eyes scan; a blob has a spinning ring     | **Working…**                                                                                                       |
| A number badge on Scout; a blob pulses with **!** | **Needs you**                                                                                                      |
| A dashed count on Scout                           | Set aside                                                                                                          |
| A happy face; a blob pops a star once             | **Done**                                                                                                           |
| A worried face; a grey blob with a red badge      | **Failed**                                                                                                         |
| A dimmed blob                                     | **Quiet**                                                                                                          |
| A **>_** blob                                     | **Terminal session**: **Open terminal** or **Open terminal in Spark** opens the agent. Answer its questions there. |

Up to five session blobs show; **+N** opens the rest. With **Reduce motion** on, only faces change.

## Limits

Spark caps no time, tool calls or cost for a turn.

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
