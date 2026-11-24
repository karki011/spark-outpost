---
title: Lock Spark with the privacy screen
section: Mac app and providers
type: how-to
order: 417
summary: Cover Spark's windows when you step away, unlock with Touch ID or a code, and reset a code you forgot.
---

You'll cover Spark Outpost's windows when you step away. About 2 minutes.

## Turn it on

1. Open **Settings → General → Privacy screen**.
2. Turn on **Lock Spark when I’m away** and set a 6-digit code.
3. Set the other rows.

| Row                                              | Does                                             |
| ------------------------------------------------ | ------------------------------------------------ |
| **Lock after**                                   | Locks after 1, 5, 15 or 30 idle minutes.         |
| **Lock when the Mac sleeps or its screen locks** | Spark is locked when you come back.              |
| **Unlock with Touch ID**                         | Your code always works too.                      |
| **Hide notification text while locked**          | Notifications name no chat.                      |
| **Code**                                         | **Change code…** asks for the current one first. |

On Windows the sleep row reads **Lock when the computer sleeps or its screen locks**, and there's no Touch ID row.

## Lock and unlock

**⇧⌘L**, **Spark Outpost → Lock Spark Outpost** or a lock button locks at once. The button sits above the left bar's clock, in a narrow window's **More**, in the Settings window and on Spark Island.

On Windows, press **Ctrl+Shift+L**.

Unlock with Touch ID or your code. Five wrong codes wait a minute. On Windows only the code unlocks.

## What it covers

Spark's windows are covered and Spark Island hides. Work keeps running and notifications still arrive. Your Mac, paired devices and phone pushes are unchanged. The code is kept as a salted hash on this Mac, not in the keychain.

## Reset a forgotten code

1. On the lock screen, select **Forgot code?**, then **Use Mac password…**.
2. Confirm with Touch ID, Apple Watch or your Mac password.
3. Set a new code in **Settings**. The privacy screen stays off until you do.

No **Forgot code?** link? Quit Spark and delete `app-lock.json` in `~/Library/Application Support/Spark Outpost`. That removes the privacy screen.

Windows has no **Forgot code?** yet. Quit Spark and delete `app-lock.json` in `%APPDATA%\Spark Outpost`.

**Next:** [Manage providers, models and Jev](providers-and-models.md)
