# Unreleased changes

Changes through 0.1.0-beta.5 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- **Send a test notification** in a paired device's menu on the Remote control page sends one fixed-text push to that device and says what happened.
- Changing the theme spreads with a soft edge. Effort in agent labels reads High, and a sub-agent on another model than the chat shows a **Different model** tag.
- Edits in a chat's work log show the file with +N −M and open to the diff, in every mode. A secret file shows only its path.
- The Map has a **Running chats** switch that marks the files working chats are changing and lists each chat; an area has **Open in chat**.
- A Jira or Linear ticket's detail has a **Linked** section with its parent, subtasks and linked tickets.
- A paired device that loses the Mac says **Can't reach your Mac** and what to try.
- A chat with no title line from the agent takes the title the agent session reports. A name you set is never replaced.
- **Notify when a turn finishes or fails** on the Remote control page (off by default) adds a "Finished" or "Failed" push for a chat. A push about one waiting card opens the chat at that card.
- The macOS permission text for the microphone now says a meeting you started records too, and Spark has a text for System Audio Recording. Recording a meeting is not in this release.
- Today has a new look: one card with Month and Day, your reply on each event (Accepted, Maybe, Not answered, Declined), details on hover, and free time marked between meetings in Day.
- The Voice shortcut dictates into the chat you're looking at when Spark is in front; anywhere else it opens the island as before.
- Voice uses one speech model, **Parakeet**; Whisper base and Whisper large v3 turbo are gone and there is no model to pick. If you had chosen a Whisper model, Parakeet downloads by itself the next time Spark starts with Voice on.
- The Mac app checks for an update every hour instead of every 4 hours. With **Download updates automatically** on (the default), a new version downloads in the background as before.
