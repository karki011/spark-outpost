---
title: What an outpost request may do
section: Understand Spark
type: concept
order: 513
summary: Why a request follows the receiving chat's own mode and autonomy, whose words count as you asking, and what no request can change.
---

A request runs under the receiving chat's own agent mode and autonomy. Only words you wrote count as you asking, and nothing a request says gives a chat more permission.

## Three examples

| Case                                                 | What happens                                                 | Why                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| A request another chat wrote says "open a PR".       | A chat on **Automatic** keeps the change and doesn't push.   | It is a colleague's suggestion, not you asking.              |
| You type `@api fix it and open a PR` in the outpost. | The chat pushes its branch and opens its pull request.       | It is your message, exactly as if you typed it in that chat. |
| The receiving chat is on **Full auto → PR**.         | It opens its pull request for work that any request started. | That is the setting you chose for that chat.                 |

The first case also covers Spark actions such as tickets and Slack: text you didn't write never asks for them. Agents can't send requests yet; the rule is already in place.

An agent mode that publishes without asking, such as **Auto**, works like the third case. When the mode raises an approval card, it appears in that chat and the request reads **Needs you**.

## What never changes

| Rule                                             | Means                                   |
| ------------------------------------------------ | --------------------------------------- |
| Nothing merges.                                  | You merge pull requests yourself.       |
| No force pushes.                                 | In every mode.                          |
| A chat pushes only its own branch.               | Never another chat's branch.            |
| A request can't raise a chat's mode.             | You set mode and autonomy in each chat. |
| [Protected paths](protected-paths.md) still ask. | Whoever wrote the request.              |

See [modes and levels](modes-and-levels.md) and [When to use an outpost](when-to-use-an-outpost.md).
