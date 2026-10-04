# Spark Outpost changelog

Newest first. Each release adds a section before packaging; the release script turns this file into `release-notes.html` on the update feed.

## 0.1.0-beta.2

- Plan card: "Build this plan?" waits for you in Automatic; Full auto → PR still continues on its own.
- Two autonomy levels (Automatic, Full auto → PR). Spark follows the agent's mode and adds no command cards of its own.
- Chat: plain step names, one status line, steps collapsed by default, one wider column on wide windows, a context rail with an outline and a docked Agent TV.
- Sparks: the blob comes from the name, instructions can come from a file, `@Name` hands a job to a Spark as a read-only subagent, and Settings → Sparks can delete one.
- Tickets: the inbox sidebar is back, with status badges, reporter, created date, pull requests and a resizable detail pane.
- Spark Island: wider, attached to the top edge, shows each chat's state, takes dropped files and folders, and uses Spark's own folder picker.
- Agents can find code with `spark_find`, search tickets and manage MCP servers through Spark tools.
- Docs rewritten into short task pages with a "What do you want to do?" start page.
- Faster: smaller startup bundle, cheaper blob animation, quicker turn start, fewer database queries and writes.
- Fixed: deleting chats, projects and Sparks in the Mac app; attachment links open inside Spark; the Map's stray card borders.
- New Dock icon without the white tile.

## 0.1.0-beta.1

First beta for a few testers.

- First packaged desktop build: bundled Postgres, agent adapters and server.
- Updates in the background on Stable or Beta, installed on quit or with Restart to update, never while agents are working.
- A backup before every update that changes the database, restored automatically if the update fails.
- Settings › Help: export diagnostics, show the logs folder and send feedback. Also in the Help menu.
- App logs in `~/Library/Application Support/Spark Outpost/logs`, with keys and tokens redacted.
- Beta builds start on the Beta update channel.
