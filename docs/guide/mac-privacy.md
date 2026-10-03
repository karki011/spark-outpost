---
title: Mac privacy settings
section: Mac app and providers
type: how-to
order: 416
summary: Turn the anonymous heartbeat off, decide on Full Disk Access, and answer the macOS keychain prompt.
---

You'll set the three privacy choices that exist only in the Mac app. About 2 minutes.

## Anonymous heartbeat

1. Open **Settings → Help**.
2. Turn **Send anonymous heartbeat** off or on. It's on by default.

About 30 seconds after the app starts, and then once a day, the app sends this to the Spark Outpost team:

| Sent                                                  | Never sent                                 |
| ----------------------------------------------------- | ------------------------------------------ |
| A random install ID, stored as a hash                 | Chats, code, file or project names         |
| App version, operating system, Intel or Apple silicon | Your name or keys                          |
| Stable, Beta or Dev build                             | Your IP address, which isn't stored either |

Cloudflare, which receives it, adds the country. Spark in a browser sends nothing.

## Full Disk Access

It's optional. It stops macOS asking each time an agent reads a protected folder, such as `~/Library`, Desktop, Documents or Downloads.

1. Open **Settings → Help** and find **Full Disk Access**.
2. Select **Open System Settings**.
3. Under **Privacy & Security → Full Disk Access**, switch on **Spark Outpost**.

Without it, macOS may ask once per folder, and you can allow those one at a time. It doesn't replace Spark's own [approvals](approvals.md).

## Keychain prompt

The first time Spark reads a key, macOS may ask whether Spark Outpost may use its keychain item.

1. Select **Always Allow**. Updates keep that permission.

Spark keeps working while the prompt is open. After 10 seconds it stops waiting, and a test message says it's waiting for the keychain.

**Next:** [Manage providers, models and Jev](providers-and-models.md)
