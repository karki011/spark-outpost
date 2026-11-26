---
title: Share an artifact
section: Chats
type: how-to
order: 215
summary: Send a page an agent made as a link anyone can open in a browser, with an optional passcode, and stop sharing it.
---

Give someone a page an agent made. About 1 minute.

1. Open the artifact from its card in the chat. It opens in the Work panel.
2. Pick the version in the version menu, then select **Share…**.
3. Turn on **Require a passcode** if the page is private. Spark makes the code.
4. With [your own Cloudflare account](connect-cloudflare.md), pick **Link ends after**, up to 7 days. Spark's shared service gives 1 day.
5. Select **Create link**. Spark copies the link; select **Copy code** if there is one, and send the code separately from the link.
6. Select **Done**. The button now reads **Shared**.

The passcode shows only in that window. Spark doesn't keep it. Five wrong codes lock the link for that visitor for 15 minutes.

## Stop sharing

1. Select **Shared**, then **Stop sharing**. The page is gone for everyone at once.

If Spark can't remove the page, Stop sharing says why and the button stays **Shared**.

Deleting the chat or artifact takes its pages down too. Spark retries hourly until the link expires.

## What leaves your computer

| Sent to the share service                        | Never sent                        |
| ------------------------------------------------ | --------------------------------- |
| The version you picked, as stored, and its title | Your chats, other versions, files |
| The passcode, if any, and your theme's colours   | Your sign-ins and other keys      |
| Your upload key, to your own service             |                                   |

A page that holds a secret value isn't shared. An SVG is sent inside a page that shows it as an image, so its scripts don't run. Markdown artifacts can't be shared yet.

Each version gets one link. To change its passcode or end date, stop sharing and share again. Only your click shares: agents, Ask Spark and [paired devices](use-your-phone.md) can't.

**Shared from** names where the page goes. With no service, **Share…** offers **Connect Cloudflare**.

**Next:** [Review, keep or revert changes](review-changes.md)
