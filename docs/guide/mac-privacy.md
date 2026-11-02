---
title: Mac privacy settings
section: Mac app and providers
type: how-to
order: 416
summary: Turn the anonymous heartbeat off, decide on Full Disk Access, and answer the macOS keychain prompt.
---

You'll set the three privacy choices only the Mac app has. About 2 minutes.

## Anonymous heartbeat

1. Open **Settings → Help**.
2. Turn **Send anonymous heartbeat** off (on by default).

About 30 seconds after starting, then daily, the app sends this to the Spark Outpost team:

| Sent                                                  | Never sent                         |
| ----------------------------------------------------- | ---------------------------------- |
| A random install ID, stored as a hash                 | Chats, code, file or project names |
| App version, operating system, Intel or Apple silicon | Your name or keys                  |
| Stable, Beta or Dev build                             | Your IP address, not stored either |

Cloudflare receives it and adds the country. Spark in a browser sends nothing.

## Full Disk Access

Optional: it stops macOS asking once per protected folder Spark reads, such as `~/Library`, Desktop, Documents or Downloads.

1. Open **Settings → Help** and find **Full Disk Access**.
2. Select **Open System Settings**.
3. Under **Privacy & Security → Full Disk Access**, switch on **Spark Outpost**.

It doesn't replace Spark's [approvals](approvals.md).

## Keychain prompt

The first time Spark reads a key, macOS may ask whether Spark Outpost may use its keychain item.

1. Select **Always Allow**. Updates keep that permission.

Spark keeps working meanwhile; after 10 seconds it stops waiting, and a test message says it's waiting for the keychain.

**Next:** [Manage providers, models and Jev](providers-and-models.md)
