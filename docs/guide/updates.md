---
title: Update the app
section: Mac app and providers
type: how-to
order: 414
summary: Install an update from the blob above Settings, pick Stable or Beta, and see what happens to your data and running work.
---

You'll install an update when it suits you. About 1 minute.

The Mac app checks at start and every hour, never installing while agents work.

## Install an update

1. Select the gray **Update** blob above **Settings**; it fills while downloading.
2. Select **Restart** when the blob shows it.

![The Update blob above Settings in the rail](images/updates-rail-blob-light.png)

A ready update installs when you next quit. While a chat runs or waits, the blob says **Waiting**; a failed restart returns it to **Restart**, saying why.

## Stable or Beta

1. Open **Settings → Updates**.
2. Under **Channel**, pick **Stable** (default) or **Beta** (features earlier, rougher).

![Settings, Updates: Version, Update ready, Channel, Download updates automatically and Check for updates](images/updates-section-light.png)

Spark never downgrades: moving to Stable keeps your version until Stable catches up.

## Download updates automatically

1. In **Settings → Updates**, **Download updates automatically** is on by default.
2. Turned off, it downloads only when you select **Update** or **Get the update**.
3. **Check now** looks for one.

## Your data during an update

Before an update changes the data format, Spark backs up your database to `~/Library/Application Support/Spark Outpost/backups`, keeping the three newest.

On failure, Spark restores your data, skips that version and shows **Open previous version instructions**.

> **Important:** If your data couldn't be put back, don't delete anything; the instructions explain recovery.

## Preview the update flow

1. In the dev app, select **Preview the update flow** in **Settings → Updates**, or run `SPARK_UPDATE_PREVIEW=flow pnpm desktop:dev`.

It fakes an update; your version and data stay.

**Next:** [Mac privacy settings](mac-privacy.md)
