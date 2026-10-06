---
title: Protected paths
section: Reference
type: reference
order: 616
summary: The hard rails - what always asks or is refused in every agent mode and at both autonomy levels.
---

These hold in every agent mode, at both autonomy levels, for every agent. No setting turns them off.

## What always asks

| What                         | Examples                                                                                                             | What happens                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Secret files**             | See the list below                                                                                                   | Changes ask. Reading follows your agent's mode.                                |
| **Files in `.sparkignore`**  | Anything you [list](sparkignore.md)                                                                                  | Reading asks too.                                                              |
| **Agent instruction files**  | `AGENTS.md` and `CLAUDE.md` at any depth, `.github/copilot-instructions.md`, `.claude/`, `.cursor/rules/`, `.spark/` | Always ask, with **Allow once** or **Allow for this chat**.                    |
| **Git hooks and config**     | `.git/hooks/*`, `.git/config`, `git config` commands                                                                 | Ask with hold to confirm. Other files in `.git` can't be changed.              |
| **Outside the linked repos** | Changing or deleting files outside the project                                                                       | Asks, naming the path. Temp folders such as `/tmp` follow your mode. No reads. |
| **Force pushes**             | `git push --force-with-lease` to a named, non-default branch                                                         | Asks with hold to confirm; no "always" option.                                 |
| **Sending data out**         | Any network send after the run read secrets                                                                          | Asks, once at a time.                                                          |

![The Change agent instructions card with Allow once, Allow for this chat and Deny](images/approvals-instructions-light.png)

Claude can't edit secret files or force push even in **Bypass permissions**. Reads are logged by path; a command that does more asks. Codex's sandbox blocks secret files.

## What is always refused

- Pushing any branch but the chat's own `spark/` branch, including the base branch.
- Plain `--force`, `+refspec`, mirror and default-branch force pushes.
- Changing remotes.
- Merging a pull request.
- Hosting tools other than `gh pr create`, `gh pr view` and `gh pr edit` for the chat's own pull request.

A blocked step says "Spark's policy blocked", so you can tell it from your own **Deny**.

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
