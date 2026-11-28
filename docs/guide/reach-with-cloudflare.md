---
title: Reach this computer through Cloudflare
nav: Reach it with Cloudflare
section: Other devices
type: how-to
order: 1015
summary: Sign in to Cloudflare once and Spark gives this computer a private address on your own domain.
---

Use Remote control without Tailscale. About 2 minutes. On a Mac, this needs macOS 15 or later.

You need a free Cloudflare account with a domain in it, and Zero Trust turned on there (free; Cloudflare may ask for a payment method).

1. Open **Remote control** and choose **Custom domain**.
2. Under **Set it up with Cloudflare**, type an **Address** on your domain, such as `spark.example.com`, and **Your email**.
3. Read what Spark asks for, then select **Allow on Cloudflare**.
4. In your browser, sign in to Cloudflare and allow Spark Outpost.
5. In Spark, wait for the six steps to read **Done**.

Remote control turns on at that address. Pair a device as usual: [Control Spark from another device](use-your-phone.md).

A step that reads **Needs you** says why and offers its fix. Finished steps are kept.

| Fact               | Detail                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| What Spark creates | One tunnel, one DNS record and one sign-in page, in your account                                        |
| Who gets in        | Cloudflare's sign-in page lets in only the email you typed; pairing still needs a code you confirm here |
| What Spark keeps   | The tunnel's key, in this computer's keychain; no access to your Cloudflare account                     |
| When it works      | While Spark is open on this computer                                                                    |
| Tailscale          | Turned off for Remote control while a custom domain is on                                               |
| Cost               | On your Cloudflare account; the free plan covers this                                                   |

**Cloudflare Tunnel: Connected** under the address means devices can reach this computer.

**Turn off** stops the tunnel and deletes its key from this computer. The tunnel, DNS record and sign-in page stay in Cloudflare; delete them there, under **Zero Trust** and your domain's **DNS**.

Spark never replaces a DNS record it did not make. If the address is taken, pick another.

An agent can fill in the address and email; you still select **Allow on Cloudflare**.

**Next:** [Answer cards from a paired device](answer-remotely.md)
