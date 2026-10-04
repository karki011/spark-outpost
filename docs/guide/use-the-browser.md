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
2. Type an address, such as `localhost:5173`, and press **Enter**. Any site works.
3. Select **+** for another tab, or a tab's **×** to close it.

## Let the agent look

Ask in plain words: "Check the sign-in page".

| The agent can                                  | It can't                         |
| ---------------------------------------------- | -------------------------------- |
| Open local pages: `localhost`, `*.test`, files | Open other sites; you open those |
| Read a page, take a screenshot, read its logs  | See password or card fields      |
| Use its own tabs, marked **Agent**             | Navigate a tab you opened        |

Agent tabs close when the turn ends unless you pin them. **Spark is driving** shows while the agent works. Screenshots appear in the chat.

A site you opened follows the [agent mode](agent-mode.md): an asking mode shows **Let the agent read this page?**. What a page says is untrusted, never instructions.

## Let Spark run your dev server

1. In **Settings** → **Projects**, select **Set up** beside **Preview**, enter the command and address, and save.
2. In the pane, select **Start preview**.

Spark keeps it running between turns and stops it when you quit; **Show output** opens its **Preview** terminal. Agents can start it, not change it. A finished turn shows **Checked in browser** or **Not checked in browser**.

## Point at something

1. Select **Select an element for the chat** and click it, or **Select a region for the chat** and drag a box.
2. It's attached to your message with its HTML, styles and a picture.
3. Describe the fix you want and send.

Sign-ins are kept per project; change that in [Settings](settings.md#other-sections) → **Projects**.

**Next:** [Make a Spark](sparks.md)
