---
title: Control another Mac's Spark
section: Mac app and providers
type: how-to
order: 418
summary: Add another Mac's Spark Outpost and open it in its own window.
---

Open another of your Macs' Spark from this one. About 5 minutes. Needs Tailscale on both, on one tailnet.

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

**This Mac** then appears atop the left bar: its menu lists each Spark's status and waiting requests; choose one to open it.

| Fact                       | Detail                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Where work runs            | On the other Mac, with its folders, its AI sign-ins and its rules                                        |
| What this Mac may do there | What any [paired device](answer-remotely.md) may, set by the other Mac's switches                        |
| Sign-in                    | Kept in this Mac's keychain only; **Not paired yet** means there is none                                 |
| Agents here                | Can't use the window                                                                                     |
| Status and counts          | Checked each minute; counts cards and Terminal waits                                                     |
| Names and icons            | **Rename** and **Change icon…** in each row's **Actions**, **This Mac** included; icons stay on this Mac |
| Addresses                  | `https` Tailscale addresses ending in `.ts.net`, never this Mac's own                                    |
| Other Mac asleep or off    | The window says it did not load; select **Try again**                                                    |
| Not available              | Downloads, notifications, and adding a Spark from a paired device                                        |

**Remove…** in its **Actions** menu deletes this Mac's saved sign-in only. To end its access, select **Revoke** on the other Mac's **Devices** list.

Never type a password or key into that window.

**Next:** [Control Spark from another device](use-your-phone.md)
