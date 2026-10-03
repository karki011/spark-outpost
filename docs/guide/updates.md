---
title: Update the app
section: Mac app and providers
type: how-to
order: 414
summary: Install an update from the blob above Settings, pick Stable or Beta, and see what happens to your data and running work.
---

You'll install an update when it suits you. About 1 minute.

The Mac app checks for updates when it starts and every 4 hours. It never installs while agents are working.

## Install an update

1. Select the gray **Update** blob in the rail, just above **Settings**. It fills as the update downloads.
2. When the blob says **Restart**, select it.

![The Update blob above Settings in the rail](images/updates-rail-blob-light.png)

A ready update also installs the next time you quit. While a chat is running or waiting for you, the blob says **Waiting**.

## Stable or Beta

1. Open **Settings → Updates**.
2. Under **Channel**, pick **Stable** (the default) or **Beta** (new features earlier, rougher).

![Settings, Updates: Version, Update ready, Channel, Download updates automatically and Check for updates](images/updates-section-light.png)

Spark never installs an older version. Moving from Beta to Stable keeps your version until Stable catches up.

## Download updates automatically

1. Open **Settings → Updates**. **Download updates automatically** is on by default.
2. Turn it off to download only when you select **Update** or **Get the update**.
3. Select **Check now** to look for an update.

## Your data during an update

Before an update changes how data is stored, Spark backs up your database to `~/Library/Application Support/Spark Outpost/backups` and keeps the three newest.

If the change fails, Spark restores your data, skips that version, and shows **Open previous version instructions**.

> **Important:** If the message says your data could not be put back, don't delete anything. The instructions explain how to recover it.

## Preview the update flow

1. In the dev app, select **Preview the update flow** in **Settings → Updates**, or start it with `SPARK_UPDATE_PREVIEW=flow pnpm desktop:dev`.

It fakes an update. Your version and data stay the same.

**Next:** [Mac privacy settings](mac-privacy.md)
