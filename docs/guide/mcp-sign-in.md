---
title: Sign in to an MCP server
section: Projects and shipping
type: how-to
order: 334
summary: Sign in once to an MCP server that asks for it, and what Spark keeps so agents can use it without asking again.
---

Some MCP servers reached by URL ask you to sign in. Do it once. About 1 minute. On the Mac.

## Sign in

1. Open **Settings → Connectors → MCP servers** and open the server.
2. Select **Sign in**. If you ran **Test connection** first and the server refused it, the card already says it needs a sign-in.
3. Approve Spark Outpost in your browser, then come back.

The card says **Signed in**. Select **Test connection** to list the server's tools.

## What Spark keeps

The sign-in stays in your keychain, never in Spark's database or a chat. Spark renews it by itself, also after a restart, and gives agents a fresh token when a turn starts.

You are asked again only when the server refuses the saved sign-in. The card then says it needs a sign-in.

## Sign out

Select **Sign out**. Spark also forgets the sign-in when you remove the server or change its URL.

Servers started by a command have no sign-in here; give them a token as an environment variable. A server that offers no sign-in Spark can use takes its token as a header.

**Next:** [Settings](settings.md)
