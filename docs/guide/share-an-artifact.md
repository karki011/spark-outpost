---
title: Share an artifact
section: Chats
type: how-to
order: 215
summary: Send a page an agent made as a link anyone can open in a browser, with an optional passcode, and stop sharing it.
---

Give someone a page an agent made, such as a chart or a report. About 1 minute.

1. Open the artifact from its card in the chat. It opens in the Work panel.
2. Pick the version in the version menu, then select **Share…**.
3. Turn on **Require a passcode** if the page is private. Spark makes the code.
4. Pick when **Link ends after**: 1 day or 7 days (the default).
5. Select **Create link**. Spark copies the link; select **Copy code** if there is one, and send the code separately from the link.
6. Select **Done**. The button now reads **Shared**.

The passcode shows only in that window. Spark doesn't keep it. To get a new one, stop sharing and share again. Five wrong codes lock the link for that visitor for 15 minutes.

## Stop sharing

1. Select **Shared**, then **Stop sharing**. The page is gone for everyone at once.

If Spark can't remove the page, Stop sharing says why and the button stays **Shared**.

Deleting the chat or artifact takes its pages down too, as does a failed share. Spark retries hourly until the link expires.

## What leaves your Mac

| Sent to Spark's share service                    | Never sent                        |
| ------------------------------------------------ | --------------------------------- |
| The version you picked, as stored, and its title | Your chats, other versions, files |
| The passcode, if any, and your theme's colours   | Your keys or sign-ins             |

A page that holds a secret value isn't shared. An SVG is sent inside a page that shows it as an image, so its scripts don't run. Markdown artifacts can't be shared yet.

Each version gets one link. To change its passcode or end date, stop sharing and share again. Only your click shares: agents, Ask Spark and [paired devices](use-your-phone.md) can't.

Without a share service, only **Shared** shows, to stop a live link.

**Next:** [Review, keep or revert changes](review-changes.md)
