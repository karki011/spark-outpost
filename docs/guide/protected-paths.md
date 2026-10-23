---
title: Protected paths
section: Reference
type: reference
order: 616
summary: The hard rails - what always asks or is refused in a chat, in every agent mode and at both autonomy levels.
---

These hold in every chat, agent mode and autonomy level, not in [Terminal sessions](terminals.md). No setting disables them.

## What always asks

| What                         | Examples                                                                                                                                 | What happens                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Secret files**             | [Below](#secret-files)                                                                                                                   | Claude refuses changes, even in **Bypass permissions**; Codex asks, and its sandbox blocks them. A command that changes one asks. Reads follow your mode, logged by path. |
| **Files in `.sparkignore`**  | Anything you [list](sparkignore.md)                                                                                                      | Reading asks too.                                                                                                                                                         |
| **Agent instruction files**  | `AGENTS.md`, `CLAUDE.md` at any depth, `.github/copilot-instructions.md`, `.agents/`, `.claude/`, `.codex/`, `.cursor/rules/`, `.spark/` | **Allow once** or **Allow for this chat**.                                                                                                                                |
| **Git hooks and config**     | `.git/hooks/*`, `.git/config`, `git config` setting a value, `--global` too                                                              | Hold to confirm, in a worktree too. Other `.git` files can't change.                                                                                                      |
| **Outside the linked repos** | Changes or deletes outside the project                                                                                                   | Asks, naming the path. Temp folders like `/tmp` follow your mode. No reads.                                                                                               |
| **Force pushes**             | `git push --force-with-lease` to a named, non-default branch                                                                             | Hold to confirm; no "always" option. Claude can't, even in **Bypass permissions**.                                                                                        |
| **Sending a secret value**   | A push, `gh` upload, or site address or text holding a secret file's value                                                               | Hold to confirm, naming the file.                                                                                                                                         |

![The Change agent instructions card with Allow once, Allow for this chat and Deny](images/approvals-instructions-light.png)

Reading git config follows the mode. Where a mode runs commands unasked, other commands changing these files, `git -C <dir> config` included, are [flagged](approvals.md#actions-that-ran-without-review) instead.

## What is always refused

- Pushing any branch, the base branch included, but the chat's `spark/` or [adopted pull request branch](where-spark-works.md#work-on-a-pull-request).
- Plain `--force`, `+refspec`, mirror and default-branch force pushes.
- Changing remotes.
- Reading, copying or changing Spark's browser data: Browser profiles, **Personal** included, the app's own sign-in storage and the database holding history. Claude and Codex block it too.
- Your ChatGPT or Claude account's own apps and connectors, in a chat (a [Terminal session](terminals.md) keeps them); add MCP servers in Spark instead.
- Merging a pull request, approving or dismissing reviews, `--admin`, `gh api` writes and `gh auth`, even if added in [Spark rules](#spark-rules).

A blocked step says "Spark's policy blocked", unlike your own **Deny**. An unseen push, in a mode that doesn't ask, is [flagged](approvals.md#actions-that-ran-without-review) instead.

## Spark rules

**Settings → Spark rules** sets which `gh` commands, beyond reads and [publish rules](#when-an-agent-may-publish), an agent may run.

| Rule                                                                   | Default                      |
| ---------------------------------------------------------------------- | ---------------------------- |
| **Run a workflow**: `gh workflow run`, `gh run rerun`, `gh run cancel` | **Follows the agent's mode** |
| **Other commands**, unless you add one such as `gh release create`     | **Refused**                  |

Following the mode: at once in **Auto**, **Bypass permissions**, **Approve for me** and **Full access**; a card otherwise. It's a send. A refusal shows a [card](cards.md#around-the-result).

## Secret files

| Kind             | Patterns                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Environment      | `.env` and `.env.*`, except `.env.example`                                                     |
| Keys             | SSH keys (`id_rsa`, `id_ed25519`), `*.pem`, `*.key`, `*.p12`, `*.pfx`                          |
| Credential files | `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credentials` files, `api-token` |

A script that reads one follows your mode. A script that names one and changes files asks, naming the file. Ship leaves these out of commits.

## When an agent may publish

An agent may push the chat's own branch and open its pull request only when:

- your message asks, such as "open a PR" or "push it" ("push it, but don't open a PR" allows only the push);
- the chat is at **Full auto → PR**;
- the agent's mode is **Auto**, **Bypass permissions** or **Full access**;
- the turn fixes [feedback](pr-follow-up.md) on the chat's own open pull request.

Otherwise the push is refused, not asked about, and you [ship](ship-and-pull-requests.md).
