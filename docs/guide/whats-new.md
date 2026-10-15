---
title: What's new
section: Help
type: whats-new
order: 720
summary: Recent changes you can see in the app, newest first, and what to do about each.
---

What changed recently in Spark, newest first.

## October 2026

| What changed                                                                                                                                                                         | What to do                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Terminals use SF Mono when it's installed on your Mac, and Menlo otherwise.                                                                                                          | Get it from [Apple](https://developer.apple.com/fonts/).             |
| Agents read long pages controls first, read only an open dialog, and keep their place when a page redraws, so they reread less.                                                      | See [the browser](use-the-browser.md#let-the-agent-look-and-browse). |
| An agent's click in the Browser pane skips an element a banner or invisible layer covers, and the agent is told what covers it.                                                      | See [the browser](use-the-browser.md).                               |
| In a Terminal session, Browser pane picks go into the terminal's input. Right-click highlighted page text, or press **⌘⇧A**, to add it to a chat or terminal.                        | See [the browser](use-the-browser.md#point-at-something).            |
| **Record Terminal sessions like chats** keeps a Claude Terminal session's commands, replies, changed files and audit, and flags risky pushes. Off by default.                        | See [settings](settings.md#record-terminal-sessions).                |
| A Claude Terminal session's cost by turn now comes from Claude Code as each request finishes, and counts sub-agents and turn time.                                                   | See [terminals](terminals.md).                                       |
| A paired device's message to Claude in a Terminal session waits until Claude is idle. Claude shows the connected device and pull request.                                            | See [remote control](use-your-phone.md).                             |
| A paired device can get a notification when a chat needs you: turn it on on the Mac, then **Notify this device**. **Sender contact** sets what push services see and shows refusals. | See [remote control](use-your-phone.md).                             |
| On a paired device, a Terminal session's **Deny** takes a reason, **Send now** stops the turn, and steps fold into one row.                                                          | See [remote control](use-your-phone.md).                             |
| **Pause** in the left bar holds the work Spark starts by itself; running turns and messages you send go on. A paired device can pause and resume too.                                | See [pause automatic work](pause-spark.md).                          |
| Search in **Sessions** and the chat list matches words from their start, shows the matching line and opens the chat at that message.                                                 | See [start a chat](start-a-chat.md#jump-between-sessions).           |
| Changing a repo's `.agents/` or `.codex/` folder, where agents keep skills and Codex settings, now asks like other agent instruction files.                                          | See [protected paths](protected-paths.md#what-always-asks).          |
| A paired device can follow a Terminal session, send it a message, stop it and approve its requests. Two switches in **Remote control** turn this on; both start off.                 | See [remote control](use-your-phone.md).                             |
