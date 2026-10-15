---
title: Control Spark from another device
section: Mac app and providers
type: how-to
order: 417
summary: Pair a device over Tailscale and choose what it may do.
---

You'll use Spark on another device; work stays on the Mac. About 5 minutes. Needs Tailscale on both, HTTPS certificates on.

1. Open **Remote control**, above **Settings**, and turn on **Remote control**.
2. Select **Pair a device**, then scan the code, or open the address and type it.
3. Check the codes match, then **Confirm**.

**Passkey.** On the device, select **Save a passkey for this device**. In another browser, choose **Sign in with a passkey**; no trip to the Mac. It never pairs a new device. **Devices** has **Allow passkey sign-in** and **Remove passkeys**.

**Devices** renames or revokes a device, passkeys included; **Remove old entry** clears a duplicate. **What paired devices can do** holds the switches. On a phone, **More** holds **Pause Spark**, Remote control and Settings; Map and Mac-only tools are hidden.

Creating or deleting an [outpost](outposts.md), changing its chats and starting a proposed story stay on the Mac.

A paired device can answer an agent's browser cards; the Browser pane stays on the Mac.

**Terminal sessions.** **Follow, type in and stop Terminal sessions** shows a session's messages and steps, with a message box and **Stop**. **Approve in Terminal sessions** adds **Deny** and **Allow**. Both start off.

While it works, **Send now** stops the turn first; in Claude an earlier queued message still goes first. **Deny** takes an optional reason the agent reads.

Messages shown aren't stored; starting a session stays on the Mac.

**Notifications.** Turn on **Notify when a chat needs you** on the Mac, then **Notify this device**. It names the chat, never a command. Push services see the **Sender contact** under the switch; refusals show there.

A device you're using gets none. iPhone needs iOS 16.4 or later and Spark on the Home Screen: save a passkey first, then sign in with it there.

**Next:** [Answer an approval card](answer-approvals.md)
