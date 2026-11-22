# Unreleased changes

Changes through 0.1.0-beta.14 are recorded in [the changelog](../apps/desktop/CHANGELOG.md). Add new changes here before the next release.

- **GitHub page: search, descriptions and Start chat.** Search pull requests with `/` across titles, numbers, repositories, authors, branches, labels, ticket keys and the first 2,000 characters of descriptions. Rows show labels and when each was opened and updated; details show branches, the description, changed files, assignees and comments. New **Reviewed by you** and **Approved by you** groups list open pull requests you already reviewed. In a wide window the page reopens on the pull request you last viewed, unless you closed it. **Start chat** opens a chat on a pull request's branch in a linked project, or a new chat with its link otherwise.
- **Share a pull request review.** A finished review on the GitHub page has **Copy review** (Markdown) and **Send to chat**, which attaches it to the pull request's chat, or a new one, as untrusted text without sending.
- **Workflow runs name their pull request.** A run started in a chat tells its steps and the chat which pull request it is about: the one your message links to, or the chat's most recently updated open one, saying it picked it when the chat has several. Steps read a pull request whose branch isn't checked out from GitHub.
