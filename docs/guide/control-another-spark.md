---
title: Control another Mac's Spark
section: Mac app and providers
type: how-to
order: 418
summary: Add another Mac's Spark Outpost and open it in its own window.
---

Open the Spark on another of your Macs from this one. About 5 minutes. Needs Tailscale on both Macs, signed in to the same tailnet.

On the other Mac:

1. Open **Remote control** and [turn it on](use-your-phone.md).
2. Select **Pair a device**, then **Copy pairing link**.

On this Mac:

3. Open **Remote control**. Under **Other Sparks**, select **Add a Spark**.
4. Paste the link into **Address or pairing link** and give it a **Name**, for example "Studio Mac".
5. A window titled **Remote control · Studio Mac** opens with the code filled in.

On the other Mac:

6. Check the codes match, see **Spark Outpost** under the name, then **Confirm**.

The window now shows the other Mac's Spark. Later, **Open** on its row signs in again.

| Fact                       | Detail                                                                            |
| -------------------------- | --------------------------------------------------------------------------------- |
| Where work runs            | On the other Mac, with its folders, its AI sign-ins and its rules                 |
| What this Mac may do there | What any [paired device](answer-remotely.md) may, set by the other Mac's switches |
| Sign-in                    | Kept in this Mac's keychain only; **Not paired yet** means there is none          |
| Agents here                | Can't see or use the window                                                       |
| Addresses                  | `https` Tailscale addresses ending in `.ts.net`, never this Mac's own             |
| Other Mac asleep or off    | The window says it did not load; select **Try again**                             |
| Not available              | Downloads, notifications, and adding a Spark from a paired device                 |

**Remove…** in its **Actions** menu deletes this Mac's saved sign-in only. To end its access, select **Revoke** on the other Mac's **Devices** list. A Spark not opened for 30 days pairs again.

The window is the other Mac's page: never type a password or key into it.

**Next:** [Control Spark from another device](use-your-phone.md)
