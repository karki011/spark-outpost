---
title: Control Spark from another device
section: Mac app and providers
type: how-to
order: 417
summary: Pair a device over Tailscale and choose what it may do.
---

Use Spark elsewhere; work stays on the Mac. About 5 minutes. Needs Tailscale.

1. Open **Remote control** above **Settings**: Tailscale, HTTPS, turn on.
2. Under **Devices**, select **Pair a device**; scan or type the code at the address.
3. Check the codes match; **Confirm**.

**Passkey.** Select **Save a passkey for this device**, then **Sign in with a passkey** in another browser. It never pairs a new device. **Devices** has **Allow passkey sign-in**.

Each device's **Actions** menu has **Rename**, **Send a test notification**, **Remove passkeys** and **Revoke**; **Remove old entry** clears a duplicate.

**What paired devices can do** groups switches by risk. A phone's **More** holds Remote control and Settings.

The right panel has the address, QR code and **Hold to disconnect all**.

Devices read the [**Sub-chats**](sub-chats.md#find-a-sub-chat) tab.

**Link a new folder or clone a repo** also allows **New folder** and agents' clones.

Devices answer [cards](answer-remotely.md). **Open artifacts** (off) shows artifacts.

**Terminal sessions.** **Follow, type in and stop Terminal sessions** shows messages, steps, a message box and **Stop**. **Send now** stops the turn first. Messages shown aren't stored.

**Approve in Terminal sessions** adds **Deny** and **Allow**; Claude's dialog says so. Both off.

**Awake.** With Remote control on, work or a connected device keeps the Mac awake, except a closed lid on battery.

**Notifications.** On the Mac, turn on **Notify when a chat needs you**, then **Notify this device**. A tap opens the chat or its card.

**Notify when a turn finishes or fails** (off) adds "Finished" or "Failed"; [meeting alerts](calendar.md) push too. Pushes name the chat, never a command, and skip seen chats and this device.

**Only notify my devices when I'm away from the Mac** (on) waits until you're idle 2 minutes or locked.

iPhone needs iOS 16.4+, Spark on the Home Screen and a passkey sign-in.

**Next:** [Answer an approval card](answer-approvals.md)
