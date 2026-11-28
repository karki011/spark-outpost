---
title: Control another computer's Spark
nav: Another computer's Spark
section: Other devices
type: how-to
order: 1030
summary: Add another computer's Spark Outpost and open it in its own window.
---

Open another computer's Spark from this one. About 5 minutes. Needs Tailscale or a custom domain.

On the other computer:

1. Open **Remote control** and [turn it on](use-your-phone.md).
2. Select **Pair a device**, then **Copy pairing link**.

On this computer:

3. Open **Remote control**. Under **Other Sparks**, select **Add a Spark**.
4. Paste the link into **Address or pairing link** and give it a **Name**.
5. A window titled **Remote control** opens with the code filled in.

On the other computer:

6. Check the codes match, see **Spark Outpost** under the name, then **Confirm**.

**Computers** then tops the left bar, listing each Spark's status and waiting requests; choose one to open it.

| Fact                            | Detail                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Where work runs                 | On the other computer, with its folders, AI sign-ins and rules                         |
| What this computer may do there | What any [paired device](answer-remotely.md) may                                       |
| Sign-in                         | Kept in this computer's keychain only                                                  |
| Agents here                     | Can't use the window                                                                   |
| Status and counts               | Checked each minute; counts cards and Terminal waits                                   |
| Names and icons                 | **Rename** and **Change icon…** in each row's **Actions**; icons stay on this computer |
| Other computer asleep or off    | The window says it did not load; select **Try again**                                  |
| Cloudflare sign-in page         | Enter the emailed code; kept in the keychain                                           |
| Not available                   | Downloads, notifications, adding a Spark from a paired device                          |

**Custom domain.** Without Tailscale, choose **Custom domain**, type your **Domain**, point your proxy or tunnel at **Forward requests to**, tick the box and **Turn on**. Or [use Cloudflare](reach-with-cloudflare.md).

Spark can't check that a custom domain is private. Adding one needs **I trust this address** and shows a **Custom domain** tag.

**Remove…** in a row's **Actions** deletes the saved sign-in and asks the other computer to end this one's access. If it's offline, **Revoke** it there.

Never type a password or key into that window.

**Next:** [Control Spark from another device](use-your-phone.md)
