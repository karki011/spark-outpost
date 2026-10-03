---
title: Approvals and protected paths
section: Stay in control
order: 310
summary: What Spark asks before an agent acts, how to answer an approval card, and which files always ask.
---

Before an agent runs a command or changes a file, Spark checks the request. Spark follows the agent's own mode: when the mode lets the agent act, Spark lets it through without a card. You see an **approval card** only when the agent's mode asks you, or when one of a few hard rails applies.

The approval checks run in Spark Outpost itself, not in the model. Nothing an agent says can approve its own request.

## What asks first

- **The agent's mode** sets the baseline. For example, Claude's **Manual** asks before edits and commands, while **Accept edits** lets edits through and asks before commands. See [Pick the agent's mode](chats-and-modes.md#pick-the-agents-mode).
- **Spark autonomy** sets what happens to the results: keep them, or keep them and open a pull request. See [Spark autonomy](chats-and-modes.md#spark-autonomy).
- **Hard rails** always ask or refuse, in every mode and at every level: secret files, changes outside the project, git hooks and config, agent instruction files and force pushes. See [Protected paths](#protected-paths).

Spark doesn't add ask rules of its own to the agent. Claude and Codex ask when their mode says so, and Spark checks each request against the hard rails. Claude's session also carries Spark's deny rules, so it can't read or edit secret files or force push even in a mode that never asks. A Builder that shares a worktree with other Builders is the exception: its edits and commands go through Spark so each one stays in its own files.

For a side-by-side view of both settings, see [Permissions and autonomy](permissions-and-autonomy.md).

## Answer an approval card

When an agent needs you, its card appears in the chat, and a one-line summary appears just above the message box, for example **Waiting for you · approve `pnpm test`** or **Waiting for you · question: Which repo?**. Hover or focus it to see the full command. The chat list shows **Asking permission**, and the **Chats** button in the rail shows a count.

![An approval card asking to run a command](images/approvals-command-light.png)

A card shows:

- **The question**, such as **Run a command?**, **Change a file?** or **Change these files?**
- **Who asks and what for**, for example "Claude wants to run a command."
- **The details**: the command, or a diff of each file. A long command shows its first six lines; select **Show all** for the rest. Select **Wrap** to wrap long diff lines.
- **Where it runs**: the folder and branch.
- **Why it asks**: the agent's own reason when the agent asked, for example "Codex couldn't run this inside its sandbox, so it asks before running it without one.", or the safety rule, for example "Secret files always ask, whatever your permissions."

![An approval card showing a file diff](images/approvals-edit-light.png)

To answer:

1. Read the command or the diff.
2. Select one of the buttons, right under the question. The labels come from the agent, so they vary a little between Claude and Codex. Typical choices:
   - **Allow**: run it this once.
   - **Always allow**: allow this kind of request for the rest of this run.
   - **Deny**: don't run it. The agent is told and tries another way.

To get back to the card, select the summary line above the message box, or press **⌘ Shift Y** (**Ctrl Shift Y** on Windows and Linux). The chat scrolls to the card and its first button gets focus. Press **Tab** to move between buttons and **Enter** to choose. The line only jumps to the card; you always answer on the card itself, so cards that need a long press keep it.

The card then shows your answer, for example "Chose: Allow." or "Denied. The command didn't run."

### Allow a command in the whole project

Command cards can also offer **Always allow in this project**. It adds the command to the project's allowlist, so chats whose agent asks before commands run it without asking. A listed command also covers the same command with more arguments: allowing `pnpm test` also allows `pnpm test -- api`.

To see or edit the list:

1. In a chat with the project linked, select the project name above the message box.
2. Open **Commands that run without asking**.
3. To add a command, type it and select **Add**. To remove one, select the **×** next to it.

![The project menu with Commands that run without asking open](images/approvals-allowlist-light.png)

**Always allow in this project** isn't offered for commands that touch protected paths, push or send data out. Those ask every time.

### Agent instruction files

Changes to agent instruction files, such as `AGENTS.md` or `CLAUDE.md`, get their own card, **Change agent instructions?**, because these files steer every agent in the project. Its buttons are:

- **Allow once**
- **Allow for this chat**: allow later changes to instruction files in this chat without asking.
- **Deny**

![The Change agent instructions card with Allow once, Allow for this chat and Deny](images/approvals-instructions-light.png)

## Hold to confirm

Two actions can do damage that's hard to undo, so their cards have no ordinary **Allow** button:

| Card                            | Why                                                                              | Button                 |
| ------------------------------- | -------------------------------------------------------------------------------- | ---------------------- |
| **Change git hooks or config?** | Git runs hooks and settings from `.git` on every commit, outside Spark's checks. | **Hold to allow once** |
| **Force push?**                 | It rewrites history on the remote.                                               | **Hold to force push** |

To allow one of these:

1. Read the change. On a git hooks card, allow it only if you've read the whole change.
2. Press and hold the button for 1.5 seconds, with the mouse or **Space**.
3. Let go early to cancel. Nothing changes.

**Deny** works as usual. These cards never offer an "always" option.

![The Change git hooks or config card with Hold to allow once](images/approvals-hold-light.png)

## Protected paths

These always ask or are refused, whatever the agent's mode and your autonomy level.

| What                         | Examples                                                                                                                                                                                       | What happens                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Secret files**             | `.env` and `.env.*` (but not `.env.example`), SSH keys such as `id_rsa`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, `credentials` files | Commands that touch them ask. Agents can't read or write them directly.                                |
| **Files in `.sparkignore`**  | Anything you list in the repo's `.sparkignore`                                                                                                                                                 | Treated exactly like secret files.                                                                     |
| **Agent instruction files**  | `AGENTS.md` and `CLAUDE.md` at any depth, `.github/copilot-instructions.md`, anything under `.claude/`, `.cursor/rules/` or `.spark/`                                                          | Always ask, with **Allow once** or **Allow for this chat**.                                            |
| **Git hooks and config**     | `.git/hooks/*`, `.git/config`, `git config` commands                                                                                                                                           | Ask with hold to confirm. Other files inside `.git` can't be changed.                                  |
| **Outside the linked repos** | Changing or deleting files outside the project, including `cp` or `>` into another folder                                                                                                      | Always asks. Writing to temporary folders such as `/tmp` is fine. Reading outside files is refused.    |
| **Pushing**                  | `git push`                                                                                                                                                                                     | Asks unless allowlisted, or publishing is allowed (see below). A force push asks with hold to confirm. |

Everything else follows the agent's mode, including package installs and commands Spark can't fully take apart. Spark reads shell commands with a real parser, so loops, `$(…)` and pipes of read-only commands such as `git log`, `git grep`, `rg`, `sed -n` and `ls` count as reads. In a run that only reads (an Ask chat or Plan), a command Spark can't take apart asks, since it might change files.

A few more rules hold everywhere:

- **Agents publish only the chat's own branch, and only when allowed.** An agent, Builders included, may push the chat's own `spark/` branch and run `gh pr create`, `gh pr view` or `gh pr edit` for its pull request when your message asks for it ("open a PR", "push it"), the chat is at **Full auto → PR**, or the agent's mode is **Auto** or **Bypass permissions**. Otherwise Builders don't push and Spark commits, pushes and opens the PR itself when the task is done. Force pushes, pushes of any other branch or the base branch, changing remotes and other hosting tools stay refused in every mode.
- **Short instructions after the work is done go to the chat's agent.** When a chat's task has already built, a short message like "open pr" or "push it" runs as one turn of the chat's main agent with the chat's own mode, not as a new Builder.
- **Modes Spark can't check run in a copy.** Claude's **Bypass permissions** and Codex's **Approve for me** and **Full access** act without Spark's approval checks, so those chats run only in a worktree copy, never on your checkout.

### Keep files away from agents with .sparkignore

To protect more files, add a `.sparkignore` file at the root of the repo:

```text
# One pattern per line. Lines starting with # are ignored.
secrets/
*.sqlite
config/production.yml
```

- `*` matches within a folder name, `**` matches across folders, and `?` matches one character.
- A pattern without `/` matches that name anywhere in the repo. A pattern with `/` starts from the repo root.
- `!` lines (exceptions) aren't supported.

Files that match are handled like secret files. They're also left out of the **@** file picker and never sent to Jev when the Map labels areas. See [Privacy and secrets](privacy-and-secrets.md#sparkignore).

## Sending data out after reading secrets

If a chat has read sensitive data, such as a secret file you allowed, Spark asks before anything in that run sends data off your computer. The card says what was read and where the data would go, for example "This run read .env earlier; sending data to example.com needs your OK".

This check applies at every autonomy level and can only be allowed once at a time.

## If you don't answer

Approval cards wait for you. If nobody answers within 30 minutes, the request is declined and the card says **Expired**.

The **If you don't answer a question** setting in **Settings → Spark** doesn't apply to approvals. It covers Spark's other questions, such as an unclear request or a stuck step. After the time you pick (**Off**, **10s**, **30s** or **60s**), Spark picks the safe option.

## Where waiting cards show

- In the chat, in the conversation, with a one-line summary above the message box. With more than one, the line says how many, for example **Waiting for you · 2 things**; select it to list them and pick one to jump to.
- On **Home**, under **What needs you today**. Select **Answer** to jump to the card.
- In the chat list (**Asking permission**) and as a count on **Chats** in the rail.
- In the chat's **Work** panel, under **Waiting for you**, with a **Review** button.
- In the desktop app's Spark Island at the top of the screen, where you can press **Y** to allow or **N** to deny. See [Spark Island](desktop-companion.md).

## See what was allowed

Each turn's steps record what happened to every request, for example "Allowed pnpm test (you allowed it)", "Allowed … (on the project allowlist)" or "Declined: … (Secret files always ask)". Requests a safety rule refused show as steps, not cards.

For the full record, open the chat's **…** menu and select **Audit this chat**. The **Timeline** tab shades the time each run waited for your approval.
