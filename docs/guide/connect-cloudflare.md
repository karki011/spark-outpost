---
title: Share from your own Cloudflare account
section: Projects and shipping
type: how-to
order: 335
summary: Sign in to Cloudflare once so shared artifacts live in your own account and links last 7 days.
---

Keep shared artifacts in your own Cloudflare account. About 2 minutes. Until then, **Share…** uses Spark's shared service with 1-day links.

You need a free Cloudflare account with R2 storage added. R2 is free to start, and its checkout may ask for a payment method.

1. Open **Settings → Connectors → Cloudflare**.
2. Under **Set it up for me**, read what Spark asks Cloudflare for, then select **Allow on Cloudflare**.
3. In your browser, sign in to Cloudflare and allow Spark Outpost.
4. Back in Spark, wait for the four steps to read **Done**.

The card reads **Connected**. **Share…** now says **Your Cloudflare account** and offers 7 days.

A step that reads **Needs you** says why and offers its fix. Finished steps are kept.

Spark asks to see the account, create a storage bucket, and create the share service. The last is Cloudflare's **Workers: Admin**, which covers every worker; Spark changes no other. The sign-in ends when set-up finishes.

No **Set it up for me**? Select **Set it up by hand instead**, about 10 minutes.

1. Select **Deploy to Cloudflare** and connect GitHub or GitLab.
2. Run `openssl rand -hex 32` twice, for `UPLOAD_KEY` and `SIGNING_KEY`.
3. Paste the address and upload key into Spark and select **Connect**.

| Fact                                  | Detail                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| Where pages live                      | A storage bucket in your account, served from your address         |
| Upload key                            | Kept in this computer's keychain; only Spark with it can add pages |
| Cost                                  | On your Cloudflare account; a few shared pages fit the free plan   |
| What Spark keeps                      | The address and the key; no access to your Cloudflare account      |
| **Share artifacts from this account** | Off sends new shares to Spark's shared service again               |

**Check again** tests the address and key. **Disconnect…** deletes the key from this computer; pages already shared stay up until they expire or you stop sharing them.

**Next:** [Share an artifact](share-an-artifact.md)
