# Unreleased changes

Changes through 0.1.0-beta.13 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- **Sub-chats replace outposts.** A chat's agent splits a job into sub-chats, nested under it in the Chats side panel, each with its own branch and pull request; the parent's Work panel has a **Sub-chats** tab, each sub-chat reports back, and the parent writes one wrap-up. Agents message other chats with `spark_send_to_chat`. Outposts, their page and their threads are gone; chats that were in one stay as plain chats.
