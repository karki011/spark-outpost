---
title: Use the browser
section: Chats
type: how-to
order: 227
summary: Open your app in the chat's Browser pane, let the agent look at it, and point at what you mean.
---

You'll open a page next to a chat, have the agent check it, and select an element for your next message. About 2 minutes. Mac app only.

## Open a page

1. Open a chat and select **Browser** in the chat header, or press **⌘⇧B**.
2. Type an address, such as `localhost:5173`, and press **Enter**. Any site works; it's your browser too.
3. Select **+** for another tab, or a tab's **×** to close it.

The pane opens on the project's last local address when it knows one.

## Let the agent look

Ask in plain words, such as "Start the dev server and check the sign-in page".

| The agent can                                  | It can't                         |
| ---------------------------------------------- | -------------------------------- |
| Open local pages: `localhost`, `*.test`, files | Open other sites; you open those |
| Read a page, take a screenshot, read its logs  | See password or card fields      |
| Use its own tabs, marked **Agent**             | Navigate a tab you opened        |

Agent tabs close when the turn ends. Select the pin on a tab to keep it. **Spark is driving** shows while the agent works on a tab. Screenshots appear in the chat.

A site you opened follows the [agent mode](agent-mode.md): in an asking mode, **Let the agent read this page?** waits for you. Spark treats what a page says as untrusted, never as instructions.

## Point at something

1. Select **Select an element for the chat**, then click the element. Or select **Select a region for the chat** and drag a box.
2. The selection is attached to your message: what it is, its HTML and styles, and a picture.
3. Describe the fix you want and send.

Sign-ins are kept per project. Turn **Keep sign-ins in the browser** off, or sign out of a site, in [Settings](settings.md#other-sections) → **Projects**.

**Next:** [Make a Spark](sparks.md)
