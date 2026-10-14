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

**Devices** renames or revokes a device, passkeys included; **Remove old entry** clears a duplicate. **What paired devices can do** holds the switches. On a phone, **More** holds Remote control and Settings; Map and Mac-only tools are hidden.

Creating or deleting an [outpost](outposts.md), changing its chats and starting a proposed story stay on the Mac.

A paired device can answer an agent's browser cards: open a site, click and type, send a secret value. The Browser pane stays on the Mac.

**Terminal sessions.** **Follow, type in and stop Terminal sessions** shows a session's messages, grouped steps and how long the agent has worked, with a message box and **Stop**. **Approve in Terminal sessions** adds **Deny** and **Allow**. Both start off.

While the agent works, **Queue message** reaches it when it can; **Send now** stops the turn first. **Deny** offers **Tell the agent why (optional)**, which the agent reads.

Messages are read from the CLI to show on the device and are not stored. Starting a session stays on the Mac.

**Next:** [Answer an approval card](answer-approvals.md)
