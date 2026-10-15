---
title: Use the browser
section: Chats
type: how-to
order: 227
summary: Open a page in the chat's Browser pane, let the agent look, browse and click, and point at what you mean.
---

Open a page beside a chat, let the agent use it, and point at things. About 2 minutes. Mac app only.

## Open a page

1. In a chat's **…** menu, select **Browser**, or press **⌘⇧B**.
2. Type an address, like `localhost:5173`; press **Enter**.
3. **+** adds a tab.

Chat and Terminal links open here; **⌘**-click or **Open in default browser** uses yours.

## Let the agent look and browse

Ask: "Check the sign-in page".

| The agent can                            | It can't                          |
| ---------------------------------------- | --------------------------------- |
| Open any web address or project file     | Reach Spark's own ports           |
| Read a page, its logs, a screenshot      | See or fill password, card fields |
| Click, type, press keys, scroll, go back | Navigate a tab you opened         |

Its tabs say **Agent** and close with the turn unless pinned. On long pages it reads controls first; with a dialog open, only the dialog.

Websites follow the [agent mode](agent-mode.md); acting on your own tab always asks. Page text is untrusted.

## Let Spark run your dev server

1. In **Settings** → **Projects**, select **Set up** beside **Preview**, enter the command and address, and save.
2. In the pane, select **Start preview**.

It runs between turns; **Show output** opens its **Preview** terminal. Agents can start it, not change it. A finished turn shows **Checked in browser** or **Not checked in browser**.

## Point at something

1. Select **Select an element for the chat** and click it, or **Select a region for the chat** and drag a box.
2. Send the **Selected:** chip.

Right-click highlighted text: **Add to chat** or **Ask about this** (**⌘⇧A**). [Terminal sessions](terminals.md) take both.

## Save a test sign-in

1. In **Settings** → **Projects**, select **Add** beside **Saved sign-ins**: a label, site and test account.
2. Ask the agent to sign in; allow the card once per chat.

Spark types them; the agent never sees them. On websites, agent tabs start signed out.

**Next:** [Make a Spark](sparks.md)
