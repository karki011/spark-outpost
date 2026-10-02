---
title: Updates
section: Desktop app
order: 520
summary: How the desktop app updates itself, Stable or Beta, the update blob above Settings, and what happens to your data and running work.
---

You'll see how Spark Outpost updates, pick a channel and install an update when it suits you. About 2 minutes.

The desktop app checks for updates when it starts and every 4 hours. It installs them when you quit or restart, and never while agents are working.

## Install an update

When an update is found, a blob appears in the rail, just above **Settings**. Your version is shown in small text under **Settings**, for example `v0.1.0-beta.1`; select it to open **Settings → Updates**.

![The Update blob above Settings in the rail](images/updates-rail-blob-light.png)

1. A gray blob labelled **Update** means an update is ready to download. Select it.
2. The blob fills with colour from the bottom as the update downloads, and shows the progress, such as **64%**. The same percentage appears next to the version under **Settings**.
3. When it's full, the blob is in full colour and says **Restart**. Select it.
4. If no agent is working, the blob says **Installing…** and the app restarts on the new version.

You don't have to click it. A ready update also installs the next time you quit Spark Outpost.

To do the same from Settings, open **Settings → Updates** and select **Restart to update** (or **Get the update**).

## Running work comes first

If any chat is running or waiting for you, Spark doesn't restart. The blob says **Waiting**: "Spark will update when your work finishes."

Spark checks again every 15 seconds and installs once nothing is running. If you quit while work is running, the app just quits and installs the update next time.

## Stable or Beta

1. Open **Settings → Updates**.
2. Under **Channel**, pick:
   - **Stable**: tested releases only. This is the default.
   - **Beta**: new features a little earlier. They can be rougher, and Stable releases still arrive. Beta builds (their version ends in `-beta.1`, `-beta.2`, …, and Settings shows a **Beta** label) start on this channel.

![Settings, Updates: Version, Update ready, Channel, Download updates automatically and Check for updates](images/updates-section-light.png)

Switching channels checks again right away. Spark never installs an older version, so moving from Beta back to Stable keeps your version until Stable catches up.

## Download updates automatically

**Download updates automatically** is on by default: updates download in the background, and one click installs them.

When it's off, Spark tells you about an update and downloads it only when you select **Update** or **Get the update**. To look for one now, select **Check now** under **Check for updates**.

## Your data during an update

Some updates change how your data is stored. Before that change runs, Spark backs up your database to the `backups` folder in its data folder, `~/Library/Application Support/Spark Outpost`. It keeps the three newest backups.

If the change fails:

1. Spark puts your data back from the backup and skips that version.
2. A message says "Spark Outpost could not continue" and whether your data was restored.
3. Select **Open previous version instructions** and follow them to reinstall the version you had.

Settings later shows "Skipped" with the version, and Spark waits for the next release.

> **Tip:** If the message says your data could not be put back, don't delete anything. The instructions explain how to recover it from the backup.

## Preview the update flow

This is for people running the dev app from a checkout. It fakes an update to the next version (for example `0.1.0-beta.1` → `0.1.0-beta.2`) so you can watch every step. Your version and data stay the same.

1. Start the dev app with `SPARK_UPDATE_PREVIEW=flow pnpm desktop:dev`, or open **Settings → Updates** in the dev app and select **Preview the update flow**.
2. After about 3 seconds the gray **Update** blob appears. Select it.
3. The blob fills over about 8 seconds, then says **Restart**. Select it.
4. The app restarts for real. Afterwards a message says "Updated to 0.1.0-beta.2 (preview)".

To see the **Waiting** step, start with `SPARK_UPDATE_PREVIEW=flow-busy`: the first restart waits as if work were running, and goes ahead at the next check 15 seconds later. With the plain `flow`, real running chats hold the restart the same way.

With **Reduce motion** on in macOS, the blob doesn't hop and its colour fills in quarter steps.

**Next:** [Settings reference](settings.md)
