---
title: Protected paths
section: Reference
type: reference
order: 616
summary: The hard rails - what Spark's rules make ask or refuse in a chat, and what is refused even with no rules.
---

By default there are no [rules](#spark-rules): **Auto** or **Bypass permissions** can force push, push any branch, edit secret files, hooks and instruction files, and publish unasked. The recommended rules give the table below, outside [Terminal sessions](terminals.md).

## What always asks

| What                         | Examples                                                                                                                                 | What happens                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Secret files**             | [Below](#secret-files)                                                                                                                   | Claude refuses changes, even in **Bypass permissions**; Codex and commands ask. Reads follow your mode, logged by path. |
| **Files in `.sparkignore`**  | Anything you [list](sparkignore.md)                                                                                                      | Reading asks too.                                                                                                       |
| **Agent instruction files**  | `AGENTS.md`, `CLAUDE.md` at any depth, `.github/copilot-instructions.md`, `.agents/`, `.claude/`, `.codex/`, `.cursor/rules/`, `.spark/` | **Allow once** or **Allow for this chat**.                                                                              |
| **Git hooks and config**     | `.git/hooks/*`, `.git/config`, `git config` setting a value, `--global` too                                                              | Hold to confirm, in a worktree too. Other `.git` files can't change.                                                    |
| **Outside the linked repos** | Changes or deletes outside the project                                                                                                   | Asks, naming the path. Temp folders like `/tmp` follow your mode. No reads.                                             |
| **Force pushes**             | `git push --force-with-lease` to a named, non-default branch                                                                             | Hold to confirm; no "always" option. Claude can't, even in **Bypass permissions**.                                      |
| **Sending a secret value**   | A push, `gh` upload, or site address or text holding a secret file's value                                                               | Hold to confirm, naming the file.                                                                                       |

![The Change agent instructions card with Allow once, Allow for this chat and Deny](images/approvals-instructions-light.png)

The recommended rules also refuse pushing any branch but the chat's `spark/` or [adopted pull request branch](where-spark-works.md#work-on-a-pull-request), plain `--force`, mirror and default-branch force pushes, and changing remotes. Unasked changes are [flagged](approvals.md#actions-that-ran-without-review).

## What is always refused

Even with no rules:

- Reading, copying or changing Spark's browser data: Browser profiles, **Personal** included, sign-in storage and the history database.
- Your ChatGPT or Claude account's own apps and connectors; add MCP servers in Spark.
- Merging a pull request, approving or dismissing reviews, `--admin`, `gh api` writes, `gh auth` and `--no-verify`.
- Reading or changing Spark's rules files.

A blocked step reads "Refused gh pr create — …".

## Spark rules

Spark reads rules from `settings.json` in its data folder and writes none; copy in the recommended rules below. A company may add `/Library/Application Support/SparkOutpost/managed-settings.json`, which yours can't loosen.

Rules go in `permissions.allow`, `ask` or `deny`; deny wins, then ask. Unlisted or allowed rules follow the mode, unflagged. A broken or unreadable file means recommended rules.

| Rule                                                                              | Covers                                                                         | Recommended  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| `Push`, `PullRequest`                                                             | Pushing or a pull request when nothing [allows it](#when-an-agent-may-publish) | deny         |
| `Push(other)`, `GitRemote`                                                        | Other branches; remotes, other hosting CLIs                                    | deny         |
| `Gh(workflow run)`, `Gh(run rerun)`, `Gh(run cancel)`                             | **Run a workflow**                                                             | allow        |
| `Gh(<group> <verb>)`, `Gh(*)`                                                     | Other `gh` commands; a named one escapes `Gh(*)`                               | deny `Gh(*)` |
| `SecretFile(edit)`, `SecretFile(read)`                                            | Secret files; `.sparkignore` reads                                             | ask          |
| `Push(force)`, `InstructionFile(edit)`, `GitConfig`, `WriteOutside`, `SecretSend` | Their rows above                                                               | ask          |

Fixed: Spark's ports, the [always refused](#what-is-always-refused) list and the Mac control, Browser pane, Calendar and web address rules.

**Settings → Spark rules** shows each rule and edits the `Gh` rules. A refusal shows a [card](cards.md#around-the-result).

## Secret files

| Kind             | Patterns                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Environment      | `.env` and `.env.*`, except `.env.example`                                                     |
| Keys             | SSH keys (`id_rsa`, `id_ed25519`), `*.pem`, `*.key`, `*.p12`, `*.pfx`                          |
| Credential files | `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credentials` files, `api-token` |

Ship leaves these out of commits.

## When an agent may publish

An agent may push the chat's own branch and open its pull request only when:

- your message asks, such as "open a PR" or "push it" ("push it, but don't open a PR" allows only the push);
- the chat is at **Full auto → PR**;
- the agent's mode is **Auto**, **Bypass permissions** or **Full access**;
- the turn fixes [feedback](pr-follow-up.md) on the chat's own open pull request.

Otherwise the recommended rules refuse it, and you [ship](ship-and-pull-requests.md).
