---
title: Protected paths
section: Reference
type: reference
order: 616
summary: The hard rails - what always asks or is refused in a chat, in every agent mode and at both autonomy levels.
---

These hold in every chat, agent mode and autonomy level, not in [Terminal sessions](terminals.md). No setting turns them off.

## What always asks

| What                         | Examples                                                                                                             | What happens                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Secret files**             | See the list below                                                                                                   | Changes ask. Reading follows your agent's mode, anywhere.                      |
| **Files in `.sparkignore`**  | Anything you [list](sparkignore.md)                                                                                  | Reading asks too.                                                              |
| **Agent instruction files**  | `AGENTS.md` and `CLAUDE.md` at any depth, `.github/copilot-instructions.md`, `.claude/`, `.cursor/rules/`, `.spark/` | Always ask, with **Allow once** or **Allow for this chat**.                    |
| **Git hooks and config**     | `.git/hooks/*`, `.git/config`, `git config` commands                                                                 | Ask with hold to confirm. Other files in `.git` can't be changed.              |
| **Outside the linked repos** | Changing or deleting files outside the project                                                                       | Asks, naming the path. Temp folders such as `/tmp` follow your mode. No reads. |
| **Force pushes**             | `git push --force-with-lease` to a named, non-default branch                                                         | Asks with hold to confirm; no "always" option.                                 |
| **Sending a secret value**   | A push or `gh` upload holding a secret file's value                                                                  | Asks with hold to confirm, naming the file.                                    |

![The Change agent instructions card with Allow once, Allow for this chat and Deny](images/approvals-instructions-light.png)

Claude can't edit secret files or force push even in **Bypass permissions**. Reads are logged by path; a command that does more asks. Codex's sandbox blocks secret files.

## What is always refused

- Pushing any branch but the chat's own `spark/` branch, including the base branch.
- Plain `--force`, `+refspec`, mirror and default-branch force pushes.
- Changing remotes.
- Merging a pull request.
- Changing things with hosting tools, except `gh pr create` and `gh pr edit` on the chat's own pull request. Reading with `gh` follows the agent's mode.

A blocked step says "Spark's policy blocked", so you can tell it from your own **Deny**. A push Spark never saw, in a mode that doesn't ask, is [flagged](approvals.md#actions-that-ran-without-review) instead.

## Secret files

| Kind             | Patterns                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Environment      | `.env` and `.env.*`, except `.env.example`                                                     |
| Keys             | SSH keys such as `id_rsa` and `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`                 |
| Credential files | `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credentials` files, `api-token` |

Ship leaves these out of commits.

## When an agent may publish

An agent may push the chat's own `spark/` branch and open its pull request only when:

- your message asks for it, such as "open a PR" or "push it";
- the chat is at **Full auto → PR**;
- the agent's mode is **Auto**, **Bypass permissions** or **Full access**;
- the turn fixes [feedback](pr-follow-up.md) on the chat's own open pull request.

Otherwise you [ship](ship-and-pull-requests.md).
