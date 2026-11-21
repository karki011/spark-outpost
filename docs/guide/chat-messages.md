---
title: Messages between chats
section: Chats
type: concept
order: 237
summary: How one chat's agent messages another, who may message whom, and why the text is never your message.
---

A chat's agent can send another chat a message and ask for a reply. The text is never your message there: it can't allow a push, a pull request or a Spark action.

## Who may message whom

| From → to                                          | Spark                                         |
| -------------------------------------------------- | --------------------------------------------- |
| A chat → its own [sub-chat](sub-chats.md)          | Follows the agent's mode.                     |
| A turn another chat's message started → the sender | Follows the agent's mode.                     |
| Such a turn → any other chat                       | Refused.                                      |
| A chat → any other chat                            | Sends if you asked by name; otherwise a card. |
| Any chat → a Terminal session or Ask Spark         | Refused.                                      |
| Any chat → an archived chat or itself              | Refused.                                      |

"Asked by name" means your own message tells the agent to message the chat and names it.

## How a message arrives

| The receiving chat | The message                                             |
| ------------------ | ------------------------------------------------------- |
| Is idle            | Starts a turn, marked **From** the sending chat.        |
| Is working         | Joins the turn in progress, labelled as not yours.      |
| Can't take it now  | Waits at the front of its queue. It never stops a turn. |
| Is paused, stopped | Waits in the queue. Remove it there; you can't edit it. |

## What you see

| Where                      | The line                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- |
| The sending chat           | **Asked** or **Sent to** the chat, with **Waiting**, **Replied** or **No reply** |
| The receiving chat         | **From** the chat, marked "not your message"                                     |
| Several rounds in one turn | One line, **N exchanges with** the chat, that opens                              |

## Replies

| When                              | The asking chat gets  |
| --------------------------------- | --------------------- |
| The other agent answers           | Its answer, at once.  |
| The turn the message started ends | The turn's reply.     |
| The turn failed or was stopped    | **No reply** and why. |
| You removed the queued message    | **No reply**.         |
| The other chat is gone            | **No reply** and why. |

A reply arrives as a message too, so nothing waits and nothing has a deadline. Every message, reply and refusal is in the audit, without its text.
