---
title: Reach this computer through Cloudflare
nav: Reach it with Cloudflare
section: Other devices
type: how-to
order: 1015
summary: Sign in to Cloudflare once and Spark gives this computer a private address on your own domain.
---

Use Remote control without Tailscale. About 2 minutes. Needs macOS 15 or later.

You need a free Cloudflare account with a domain in it, and Zero Trust turned on there (free; may ask for a payment method). A domain bought elsewhere works once you add it to Cloudflare. No domain? Use Tailscale.

1. Open **Remote control** and choose **Custom domain**.
2. Under **Set it up with Cloudflare**, type an **Address** on your domain, such as `spark.example.com`, and **Your email**.
3. Select **Allow on Cloudflare**.
4. In your browser, sign in to Cloudflare and allow Spark Outpost.
5. In Spark, wait for the six steps to read **Done**.

Remote control turns on there. Pair a device: [Control Spark from another device](use-your-phone.md).

**Needs you** on a step says why and offers its fix.

| Fact               | Detail                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| What Spark creates | One tunnel, one DNS record and one sign-in page, in your account                                        |
| Who gets in        | Cloudflare's sign-in page lets in only the email you typed; pairing still needs a code you confirm here |
| What Spark keeps   | The tunnel's key, in this computer's keychain; no access to your Cloudflare account                     |
| When it works      | While Spark is open on this computer                                                                    |
| Status             | **Cloudflare Tunnel: Connected** under the address                                                      |
| Tailscale          | Turned off for Remote control while a custom domain is on                                               |
| Cost               | The free plan covers this                                                                               |

**Turn off** stops the tunnel and deletes its key here. What Spark made stays in Cloudflare; delete it there.

Spark never replaces a DNS record it did not make, and reuses an existing sign-in page only if it lets in just your email on every path. Otherwise pick another address.

For a domain outside Cloudflare, use **Or use your own reverse proxy or tunnel**.

An agent can prefill the form; you still select **Allow on Cloudflare**.

**Next:** [Answer cards from a paired device](answer-remotely.md)
