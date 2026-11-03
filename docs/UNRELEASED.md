# Unreleased changes

Changes through 0.1.0-beta.40 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- Split chat: open a second chat beside the current one with Open in split in a chat's menu or ⌥-click (⌥Enter); click or type in a side to focus it, the other dims and keeps working, ⌘D, the terminal, the Work panel and the Browser pane follow the focused chat, both chats count as read, and the pair and divider come back after a reload (wide windows only).
- Home is wider on a wide window, so its cards wrap less.
- Chats: an `http` or `https` address in your message shows as a link card under it (site, short path, full address on hover), up to three and then "+N more". The card is built from the address alone; nothing is fetched, and an address with a login gets no card.
- Chats: important steps get their own row instead of hiding in a folded group: opening or acting on a Browser pane page, a web fetch or search, making a page with `spark_artifact` and a Mac control action, each with its own icon and a plain verb ("Opened cloudzero.com", "Searched the web for …", "Made a page: …"). Groups before and after keep their order, a running one is the live row, and a row opens to show its tool and time.
