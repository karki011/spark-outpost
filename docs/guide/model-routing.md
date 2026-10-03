---
title: How Spark picks a model
section: Understand Spark
type: concept
order: 822
summary: What a pinned model controls, how Auto picks a model for each helper, and where to read why a model was chosen.
---

The model you pin is the chat's own model: it reads, plans and coordinates, and never changes during the chat. **Auto** picks models only for the helpers, such as Builders and the Critic, per request.

![The model picker with Auto selected](images/auto-routing-picker-light.png)

| Chat is       | The chat's own model         | Builders, pieces, Critic                                              |
| ------------- | ---------------------------- | --------------------------------------------------------------------- |
| Pinned        | Your pick                    | Start from your pick; move only when the request clearly calls for it |
| **Auto**      | The provider's default model | Picked per request by rules and a score                               |
| **Spark** off | Your pick                    | None. There's no routing.                                             |

To set it, see [Pick a model and effort](auto-routing.md).

## How Auto picks

Rules come first:

- **Destructive work** always goes to the top model.
- **Trivial edits** go to a middle model.
- **Everything else** is scored. The score weighs each model's chance of getting it right against its cost, including the cost of a failed attempt.

Spark never runs a Builder on a small, fast model. It raises it to the next model up and says so.

## With Jev and without

The score needs four ratings of the request, from 1 to 5: complexity, ambiguity, stakes and context.

- **With Jev**, Jev rates the request. Ratings it's unsure about fall back to the rules.
- **Without Jev**, the rules estimate all four from the request and the code.

Either way, code calculates the score and picks the model. Jev never picks it.

## Builders in a pinned chat

- **Clearly simple work**: with Jev sure, the Builder can run one model down.
- **Hard work**: the Builder can step up a model.
- **Destructive work** goes to the top model.

Without Jev, or when Jev isn't sure, the Builder keeps your pinned model.

## Read the why-line

Hover the line above the crew, such as "Build it · 87% sure". Each Builder's why-line names the model and the reason, for example "Why Sonnet 5: rule chat model · mid tier". For models Spark stopped using, see [Model demotions](estimates-and-budgets.md#model-demotions).
