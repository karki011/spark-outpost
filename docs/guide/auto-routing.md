---
title: Pick a model and effort
section: Chats
type: how-to
order: 216
summary: Pin a model for a chat or let Auto pick one per request, and set how hard the agent thinks.
---

You'll choose the model and effort for one chat. About 1 minute.

## Pick a model

1. Select the model button in the message box. **Model, effort, and permissions** opens on **Model**.

   ![The model picker open on the Model tab](images/chats-and-modes-picker-light.png)

2. With more than one provider connected, switch **AI provider** at the top.
3. Pick a model to pin it, or pick **Auto** to let Spark choose a model for each helper, per request.

A new chat starts pinned to your default model. The pinned model reads, plans and coordinates for the whole chat. See [How Spark picks a model](model-routing.md).

## Set the effort

1. In the same picker, select the **Effort** tab.
2. Pick a level. The list comes from the model.

| Level      | Means                              |
| ---------- | ---------------------------------- |
| **Low**    | Quick replies, light reasoning     |
| **Medium** | Balanced for most tasks            |
| **High**   | Thinks longer on hard problems     |
| **Max**    | Deepest reasoning, slowest replies |

Higher effort is slower and costs more. Claude offers Low to Max, Codex Low to High, and Z.ai Low, High and Max. Some models have no effort levels.

These choices apply to this chat only. For new chats, see [Choose defaults for new chats](chat-defaults.md).

> **Tip:** Leave the chat pinned to your default. Pick **Auto** when a chat mixes small fixes and bigger work, so small requests run cheaper.

**Next:** [Follow, stop or delete a chat](follow-a-turn.md)
