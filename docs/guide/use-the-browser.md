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
2. Type an address, such as `localhost:5173`, and press **Enter**.
3. **+** adds a tab; **×** closes one.

The top-left icons switch **Work** and **Browser**.

## Let the agent look

Ask: "Check the sign-in page".

| The agent can                                  | It can't                         |
| ---------------------------------------------- | -------------------------------- |
| Open local pages: `localhost`, `*.test`, files | Open other sites; you open those |
| Read a page, take a screenshot, read its logs  | See password or card fields      |
| Use its own tabs, marked **Agent**             | Navigate a tab you opened        |

Agent tabs close with the turn unless pinned. Screenshots appear in the reply where taken; select to enlarge.

A site you opened follows the [agent mode](agent-mode.md): an asking mode shows **Let the agent read this page?**. What a page says is untrusted, never instructions.

## Let Spark run your dev server

1. In **Settings** → **Projects**, select **Set up** beside **Preview**, enter the command and address, and save.
2. In the pane, select **Start preview**.

Spark keeps it running between turns; **Show output** opens its **Preview** terminal. Agents can start it, not change it. A finished turn shows **Checked in browser** or **Not checked in browser**.

## Point at something

1. Select **Select an element for the chat** and click it, or **Select a region for the chat** and drag a box.
2. It becomes one **Selected:** chip.
3. Send.

## Save a test sign-in

1. In **Settings** → **Projects**, select **Add** beside **Saved sign-ins**: a label, the site, and a test account.
2. Ask the agent to sign in; allow the card once per chat.

Spark types them into that site only. The agent never sees them; they stay in your keychain.

**Next:** [Make a Spark](sparks.md)
