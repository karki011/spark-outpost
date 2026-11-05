---
title: Let agents use Mac apps
section: Mac app and providers
type: how-to
order: 419
summary: Let an agent read another Mac app and press its buttons and menus, and see what it never does.
---

You'll let an agent read and press in other Mac apps, one app per chat. About 2 minutes.

## Turn it on

1. Open **Settings → Mac control**.
2. Switch on **Let agents control other Mac apps**.
3. Select **Ask macOS**, or **Open Accessibility settings**, and switch on **Spark Outpost**.
4. Come back to Spark; the card shows **Allowed**.

What the agent reads goes to the model provider. Paired devices never get Mac control.

## What asks and what never happens

| The agent                                                                                | Spark                                                       |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reads or uses an app for the first time in a chat                                        | Asks in every mode: **Let the agent use … in this chat?**   |
| Presses a send, delete, submit or publish control, or Return or Enter on the focused one | Asks each time, in every mode                               |
| Presses anything else                                                                    | Follows the [agent mode](agent-mode.md), like Spark actions |
| Buys, pays, transfers or creates an account                                              | Refuses                                                     |
| Opens System Settings, passwords, a web browser, or Spark                                | Refuses; agents use the [Browser pane](use-the-browser.md)  |

Answer these cards on the Mac; the agent is told you allowed it. Agents can't type into other apps yet.

## Watch, take over and stop

- A panel names the app and the agent's last step.
- Moving the mouse or typing in that app pauses the agent until **Resume** or your next message.
- **Stop** on the panel, or **⌃⌥⌘.**, stops Mac control for the turn.
- Nothing happens while the screen is locked.

**Next:** [Answer an approval card](answer-approvals.md)
