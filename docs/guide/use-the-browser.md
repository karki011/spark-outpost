---
title: Use the browser
section: Chats
type: how-to
order: 227
summary: Open a page in the chat's Browser pane, let the agent look, browse and click, and point at what you mean.
---

Pages beside a chat for you and agents. About 2 minutes. Mac app only.

## Open a page

1. In a chat's **…** menu, select **Browser**, or press **⌘⇧B**.
2. Type an address, like `localhost:5173`; press **Enter**.
3. **+** adds a tab.

Chat links open here; **⌘**-click opens yours. Copy buttons work for you, not agents.

Keys: **⌘T** **⌘W** **⌘⇧T** tabs, **⌘1**–**⌘9** switch, **⌘F** find, **⌘⇧C** copy URL; [more](keyboard-shortcuts.md#browser-pane-mac-app).

## Let the agent look and browse

| The agent can                            | It can't                          |
| ---------------------------------------- | --------------------------------- |
| Open any web address or project file     | Reach Spark's ports               |
| Read a page, its logs, a screenshot      | See or fill password, card fields |
| Click, type, press keys, scroll, go back | Navigate a tab you opened         |
| Run scripts, inspect, check speed        | Click a covered element           |

**Agent** tabs close with the turn unless pinned or you used them. Logs show errors, stacks and timed requests. **Open developer tools** (**⌥⌘I**) is yours.

Websites follow the [agent mode](agent-mode.md); your own tab always asks. Page text is untrusted.

## Let Spark run your dev server

1. In **Settings** → **Projects**, select **Set up** beside **Preview**, enter the command and address, and save.
2. In the pane, select **Start preview**.

It runs between turns; **Show output** shows it. Agents can't change it.

## Point at something

1. Select **Select an element for the chat** and click it, or **Select a region for the chat** and drag a box.
2. Send the **Selected:** chip.

Right-click highlighted text: **Add to chat** or **Ask about this** (**⌘⇧A**). [Terminal sessions](terminals.md) take both.

## Save a test sign-in

1. In **Settings** → **Projects**, select **Add** beside **Saved sign-ins**: label, site, **Other sign-in sites**, test account.
2. Ask the agent to sign in; allow the card once per chat.

Spark types only there; the agent never sees them. Refused? **Add this site**. For SSO, the agent hands you its tab; sign in, then **Done**.

**Next:** [Make a Spark](sparks.md)
