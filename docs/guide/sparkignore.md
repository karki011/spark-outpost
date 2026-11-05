---
title: Keep files and keys away from agents
section: Projects and shipping
type: how-to
order: 312
summary: List files in .sparkignore so agents can't read or change them, and keep API keys out of chat messages.
---

You'll protect files that Spark doesn't treat as secret, and keep keys out of chats. About 2 minutes.

## Hide files with .sparkignore

1. Create a file named `.sparkignore` at the root of the repo.
2. Add one pattern per line:

   ```text
   secrets/
   *.sqlite
   config/production.yml
   ```

3. Save it. It applies from the agent's next action.

| Pattern         | Matches                                       |
| --------------- | --------------------------------------------- |
| `*`             | Any characters within one folder or file name |
| `**`            | Across folders                                |
| `?`             | One character                                 |
| No `/` in it    | That name anywhere in the repo                |
| Has a `/`       | A path from the repo root                     |
| Starts with `#` | A comment                                     |
| Starts with `!` | Not supported                                 |

Matching files are closed, unlike [secret files](protected-paths.md#secret-files):

- Agents can't read or change them; commands that touch them ask first.
- They're left out of the **@** file picker.
- Their contents never go to Jev.

A listed file can still show as a dot on the Map. Its contents are never read.

## Keep keys out of chats

Chat text is sent to the agent's provider and saved with the chat.

When a message seems to hold a secret, Spark holds it and shows "Paste API keys in Settings → AI providers instead."

1. Press **Enter** to pick **Remove it**. Each secret becomes `[removed]` to review and send.
2. Or select **Send anyway**, or press **Esc** to edit the message yourself.

Spark checks for API keys and tokens (`sk-…`, `ghp_…`, `AKIA…`, JWTs), private key blocks, and `KEY=value` lines with a long random value.

If you send anyway, it's sent and saved as written; the audit log stores it redacted.

**Next:** [Use the Map](map.md)
