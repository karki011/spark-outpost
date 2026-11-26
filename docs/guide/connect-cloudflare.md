---
title: Share from your own Cloudflare account
section: Projects and shipping
type: how-to
order: 335
summary: Set up a free Cloudflare account and connect it so shared artifacts live in your account and links last 7 days.
---

Keep shared artifacts in your own Cloudflare account. About 10 minutes. Until then, **Share…** uses Spark's shared service with 1-day links.

You need a free Cloudflare account and a GitHub or GitLab account.

1. Open **Settings → Connectors → Cloudflare**.
2. No Cloudflare account? Select **Create a free account** and sign up in your browser.
3. Select **Deploy to Cloudflare**. Sign in, connect GitHub or GitLab when asked, and keep the suggested names.
4. In a terminal, run `openssl rand -hex 32` twice. Paste one result as `UPLOAD_KEY` and the other as `SIGNING_KEY`, then deploy.
5. Copy the address Cloudflare shows, like `https://spark-share.you.workers.dev`.
6. Back in Spark, paste it into **Service address**, paste the `UPLOAD_KEY` value into **Upload key**, and select **Connect**.

The card reads **Connected**. **Share…** now says **Your Cloudflare account** and offers 7 days.

| Fact                                  | Detail                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| Where pages live                      | A storage bucket in your account, served from your address         |
| Upload key                            | Kept in this computer's keychain; only Spark with it can add pages |
| Cost                                  | On your Cloudflare account; a few shared pages fit the free plan   |
| What Spark sees                       | The address and the key, never your Cloudflare sign-in             |
| **Share artifacts from this account** | Off sends new shares to Spark's shared service again               |

**Check again** tests the address and key. **Disconnect…** deletes the key from this computer; pages already shared stay up until they expire or you stop sharing them.

Cloudflare may ask for a payment method before it creates the storage bucket.

**Next:** [Share an artifact](share-an-artifact.md)
