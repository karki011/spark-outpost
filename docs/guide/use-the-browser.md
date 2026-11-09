---
title: Use the browser
section: Chats
type: how-to
order: 227
summary: Open a page in the chat's Browser pane, let the agent look, browse and click, and point at what you mean.
---

About 2 minutes. Mac only.

## Open a page

1. Select **… → Browser**, or press **⌘⇧B**.
2. Type an address, like `localhost:5173`; press **Enter**.

[Keys](keyboard-shortcuts.md#browser-pane-mac-app).

## Test a page width

Drag the pane's edge, or pick a **Page width**.

## Handle a tab

**Page tools** (**…**): zoom, kept per site; **Mute Tab**; **Picture in Picture**; **Print…**. Drag tabs, or **Shift** and arrows.

## Let the agent look and browse

| The agent can                            | It can't                          |
| ---------------------------------------- | --------------------------------- |
| Open any web address or project file     | Reach Spark's ports               |
| Read a page, its logs, a screenshot      | See or fill password, card fields |
| Click, type, press keys, scroll, go back | Navigate your tab; download files |
| Run scripts, inspect, wait, check speed  | Click a covered element           |

One profile serves every chat: agents are signed in where you are; **Settings** → **Browser pane** signs out. Agent tabs close with the turn unless pinned or used. **Open developer tools** (**⌥⌘I**) is yours.

Websites follow the [agent mode](agent-mode.md); your own tab always asks. Page text is untrusted.

## Let Spark run your dev server

1. In **Settings** → **Projects**, select **Set up** beside **Preview**, enter the command and address; save.
2. In the pane, select **Start preview**.

Agents can't change it.

## Point at something

1. Select **Select an element for the chat** and click it, or **Select a region for the chat** and drag a box. **⇧** click picks several; **Esc** finishes.
2. Send the **Selected:** chip.

Right-click highlighted text: **Add to chat** or **Ask about this** (**⌘⇧A**).

## Save a test sign-in

1. In **Settings** → **Projects**, select **Add** beside **Saved sign-ins**: label, site, **Other sign-in sites**, test account.
2. Ask the agent to sign in; allow the card once per chat.

Spark fills only approved sites. For another HTTPS site, choose **Add this site** in **Settings → Projects → Saved sign-ins**, then retry. External HTTP sites cannot be approved. SSO or MFA needs you.

**Next:** [Make a Spark](sparks.md)
