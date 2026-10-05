---
title: How Spark picks a model
section: Understand Spark
type: concept
order: 516
summary: What a pinned model controls, how Auto picks a model for each helper, and where to read why a model was chosen.
---

The model you pin is the chat's own model: it reads, plans and coordinates, and never changes during the chat. **Auto** picks models only for the helpers, such as Builders and the Critic, per request.

![The model picker with Auto selected](images/auto-routing-picker-light.png)

| Chat is       | The chat's own model         | Builders, pieces, Critic                                              |
| ------------- | ---------------------------- | --------------------------------------------------------------------- |
| Pinned        | Your pick                    | Start from your pick; move only when the request clearly calls for it |
| **Auto**      | The provider's default model | Picked per request by rules and a score                               |
| **Spark** off | Your pick                    | None. There's no routing.                                             |

To set it, see [Pick the model, effort and mode](agent-mode.md).

## How Auto picks

| Request          | Goes to                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| Destructive work | The top model                                                             |
| Trivial edits    | A middle model                                                            |
| Everything else  | The best score: each model's chance of getting it right, against its cost |

Spark never runs a Builder on a small, fast model; it raises it one model up and says so. Auto skips models your sign-in can't use.

## With Jev and without

The score uses four ratings of the request, from 1 to 5: complexity, ambiguity, stakes and context.

| Setup       | Who rates the request                                  |
| ----------- | ------------------------------------------------------ |
| With Jev    | Jev. Ratings it's unsure about fall back to the rules. |
| Without Jev | Rules estimate all four from the request and the code. |

Either way, code picks the model; Jev never does.

## Builders in a pinned chat

A Builder can run one model down for clearly simple work when Jev is sure, and step up a model for hard work.

Without Jev, or when Jev isn't sure, the Builder keeps your pinned model.

## Read the why-line

Each Builder's why-line names the model and the reason. For models Spark stopped using, see [Model demotions](guardrails.md#model-demotions).
