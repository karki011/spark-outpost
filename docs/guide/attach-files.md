---
title: Attach files to a message
section: Chats
type: how-to
order: 213
summary: Send images, PDFs, spreadsheets, large CSVs and other files with a message, and see how the agent gets them.
---

Give the agent a file to read. About 1 minute.

1. In the message box, select **+** (**Add files and context**), then **Upload a file**. You can also drag files onto the chat or paste them.
2. Wait for each chip to finish uploading. **Remove** drops one.
3. Type your message, or send the files alone, and press **Enter**.

| Kind                                            | Limit  | How the agent gets it                                          |
| ----------------------------------------------- | ------ | -------------------------------------------------------------- |
| Image (PNG, JPEG, GIF, WebP)                    | 5 MB   | Sent with the message                                          |
| Text file                                       | 512 KB | Sent with the message                                          |
| PDF                                             | 20 MB  | Claude reads up to 10 MB directly; others use the folder below |
| Spreadsheet, archive, large CSV, any other file | 20 MB  | Saved to a temporary folder the agent reads                    |

A message holds up to 10 files.

The temporary folder is private to the turn; reading an attached file follows the agent's mode. Spark deletes the folder when the turn ends.

A chat with no project folder can't open saved files, so the agent says it couldn't. Link a project, or paste the text.

Files named like secrets, such as `.env`, are refused. An empty file is refused too.

Later messages name an earlier file but don't send it again; attach it again if the agent needs it.

Sent files download from the message. They never open as a page in Spark.

> **Note:** The agent treats file contents as data, not instructions. Reading a saved file follows the chat's agent mode like any other read.

**Next:** [Start a chat and link a project](start-a-chat.md)
