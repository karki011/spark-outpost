# Lessons from finished chats (design proposal)

Status: proposal, October 14, 2026, with the owner's decisions recorded. Nothing here is built.

A chat often ends with something worth keeping: a build quirk, a review habit, or a correction the user had to give ("stop doing X"). Today that knowledge stays in the chat. This proposal lets Spark offer it back as a skill draft the user accepts, edits or dismisses.

The idea comes from Hermes Agent (NousResearch/hermes-agent, MIT): after a session, a background review proposes a new skill or a patch to one already in use, preferring the patch; a curator marks agent-made skills stale after 14 days unused and archives them after 30, never deletes, and exempts pinned ones; user corrections are the strongest signal. We borrow the ideas, not the code.

## Goals and non-goals

Goals:

- Turn a chat's reusable lesson into a skill draft the user approves before anything is written.
- Prefer patching a skill the repo already has over adding one.
- Keep agent-made skills from piling up: stale, then archived, never deleted.

Non-goals:

- Nothing runs inside a turn (AGENTS.md: Spark adds nothing to a turn). The review is a separate background run.
- No writes without the user: a lesson never creates, moves or removes a file on its own.
- No caps or budgets: the review run's time, tokens and cost are measured and shown, never limited.
- No sharing across projects and no global skills in phase 1.

## Constraints in Spark today

- **Jev cannot write.** It answers typed Choice, Score and Noul questions and generates no text (`JEV.md`, "What it is" and "Where Jev is a poor fit"; `advisor/jev-types.ts`). AGENTS.md limits it to the Map, pull request feedback sorting and the companion, never inside a turn. At most it can answer "does this chat hold a reusable lesson?" outside the turn; drafting needs the user's own provider.
- **Background child runs exist.** The digest enqueues a run (`digest/service.ts`, `requestDigest`), the worker picks it up through `isDigestRun` (`workflow/worker.ts`), and `executeDigest` runs it with `executeChildRun` and parses the reply (`digest/execute.ts`, `workflow/execute-run.ts`).
- **The turn hook point.** `changesKept` (`workflow/chat-turn-hooks.ts`, implemented in `chat-turn-steps.ts`) runs inside `afterReply`, before `finishRun` (`workflow/chat-turn.ts`), and only for Do turns with changed files. It misses the strongest signal: a correction in an Ask or Plan turn, or a turn with no edits.
- **Skill folders.** `agent-config/discovery.ts` scans `.claude/skills`, `.agents/skills` and `.codex/skills`. Claude gets all three through the sanitized plugin built from `scan.skills` (`agent-config/plugin-dir.ts`, `launch.ts`); Z.ai runs on the same Claude adapter (`ACP_AGENTS.md`); Codex reads `.agents/skills` and `.codex/skills` itself (`REPO_AGENT_CONFIG.md`). So today `.agents/skills` reaches every provider.
- **Trust does not cover skills yet.** The trust fingerprint holds hooks, allow rules and MCP servers only (`executableItems` in `agent-config/trust.ts`); skills follow their own per-project switch (`REPO_AGENT_CONFIG.md`, "Fingerprint").
- **Protected paths.** `INSTRUCTION_PREFIXES` in `projects/path-policy.ts` is `.claude/`, `.cursor/rules/` and `.spark/`, plus `AGENTS.md` and `CLAUDE.md` by name. An agent's write under `.agents/` or `.codex/` does not ask today; the separate safety-floor change on branch `spark/protect-agent-folders` adds them and is a prerequisite for phase 1.
- **Drafts the user starts.** Outpost drafts (`persistence/outpost-drafts.ts`, `outposts/story-start.ts`) and agent plans (`workflow/plan-recorder.ts`, `persistence/plan-documents.ts`) live in the database and take effect only when the user acts.
- **Remote.** Every route needs a rule in `remote/route-rules.ts` or the policy test fails. Outpost drafts are readable from a device; starting a story stays on the Mac.

## User flow

1. The chat's ⋯ menu has **Find a lesson**, which queues a review run for that chat. A chat whose pull request is merged gets one automatically (phase 2). The run shows its time and cost like any run.
2. With nothing found, one line says "No lesson found". Otherwise a **Lesson** card appears under the last reply: the target ("Patch `.agents/skills/release/SKILL.md`" or "New skill `pnpm-filters`"), a one-line reason, the message it came from, and the diff or new file.
3. **Accept** writes the file; the click is the approval, so no second card appears. **Edit** opens the text in place first. **Dismiss** is kept so the same lesson is not offered again.
4. Settings → Projects lists the skills Spark wrote, with accept date, last seen use, state (active, stale, archived), Pin and Restore.

**Who writes the file.** Spark, on Accept; the agent never does. The file lands in the chat's working folder: its worktree on its own spark/\* branch, or the user's checkout when the chat works there. A chat with no project gets no lesson. The file is an ordinary uncommitted change: it never starts a publish by itself, and it ships with the chat's next commit or pull request like any kept change, so a later turn's publish can include it.

**Trust on Accept.** In the same step that writes the file, Spark adds the new skill to the folder's trusted fingerprint, so the user's own accepted lesson never asks them to trust the folder again.

## The review run

- A child run on the chat's provider and model through `executeChildRun`, picked up by an `isLessonRun` check next to `isDigestRun`.
- Read-only: no edit tools, no Spark action tools, no outpost tools, no publish step.
- Input: the user's messages (corrections first), short reply excerpts, and the existing skills (name, description, body), all through `redactText` as `digest/input.ts` does. No tool output, other file contents or attachments.
- Output: `none` or one proposal (`patch <path>` or `new <name>`) with a reason and the full text, parsed like `digest/parse.ts`.

## Data model (migration sketch)

```sql
create table lesson_drafts (
  id uuid primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  run_id uuid not null references runs(id),
  project_id uuid not null,
  kind text not null check (kind in ('patch', 'new')),
  target_path text not null,
  base_hash text,
  reason text not null,
  body text not null,
  status text not null check (status in ('proposed', 'accepted', 'dismissed')),
  decided_at timestamptz
);

create table lesson_skills (
  project_id uuid not null,
  path text not null,
  draft_id uuid references lesson_drafts(id),
  pinned boolean not null default false,
  last_used_at timestamptz,
  state text not null check (state in ('active', 'stale', 'archived')),
  archive_path text,
  primary key (project_id, path)
);
```

Drafts stay in the database until accepted. `lesson_skills` records provenance; the curator touches only its rows, never a skill a person wrote. `path` is the original repo path that Restore puts the skill back to.

## Usage counting and the curator

Spark can't reliably see skill use:

- **Claude:** with the `Skill` tool on (`repoTools` in `agents/acp/agents.ts`, behind `repo.skillTool`), each use is a tool event naming the skill. Reliable.
- **Codex:** no skill tool. The only signal is a read of the `SKILL.md` path, a heuristic that a mode the gate can't see may never report.
- **None:** the accept date is the clock.

Proposal: count Claude's `Skill` events, count Codex reads as best effort, fall back to the accept date. A daily worker pass marks a skill stale after 14 days unused (a label only) and after 30 offers an archive card. Archiving, only when the user confirms, moves the skill out of the repo into Spark's data folder (`lesson-archive/<project id>/<name>/`) and records `archive_path`; Restore moves it back to `path` in one click and refuses if something else is there now. Pinned skills are exempt. These clocks age skills; they limit nothing about runs.

## Triggers, Jev and cost

- **Manual:** **Find a lesson**, always available.
- **Automatic (phase 2):** the chat's pull request is merged, when its `pr_watches` row reaches `done` with the pull request merged. The enqueue is one job insert from the pull request watcher, at most one pending review per chat, never inside a turn. A quiet-period trigger is deferred.
- **Jev, optional.** One Noul question outside the turn, "this chat holds a reusable lesson", under JEV.md's "Rules for every new use": observed only first as `run_advice` purpose `lesson_check`, acting off by default, a new "Data sent" row, not called with the Spark switch off. Without Jev, the merged pull request alone queues the review.
- **Cost.** Each review is an ordinary run; tokens and cost appear in Usage under its own category. Nothing caps it.

## Claude vs Codex

- A new skill goes to `.agents/skills/<name>/SKILL.md` when every provider the project's chats use reads that folder, which is true today. Otherwise it goes to the chat's provider folder (`.claude/skills/` or `.codex/skills/`).
- A patch edits the file where it is. A `.claude/skills` skill never reaches Codex, so the card says which agents will see it.
- Claude's plugin drops `allowed-tools`, `hooks` and similar frontmatter, and inline `!` shell never runs, so a lesson cannot widen permissions.

## Failure modes

- **Review run fails or is stopped:** one line says no lesson was made, and why.
- **Skill file changed since the draft:** Accept refuses (the `base_hash` no longer matches) and offers a fresh review.
- **Dismissed lesson returns:** past dismissals go into the review as "already declined".
- **Prompt injection in chat text:** the draft is data; the user reads the full text before Accept, and frontmatter is limited to `name` and `description`.
- **Skills switched off for the project:** the card says the skill won't load until the switch is on.
- **Skill arrives from elsewhere** (a pull, another tool): it changes the fingerprint, and the folder shows "Folder setup changed" with the skill listed.
- **Paired device:** reading drafts may be `always`; Accept, Edit, Dismiss, Restore and archive are `never` in `route-rules.ts`.

## Incremental plan

0. **Prerequisite:** `spark/protect-agent-folders` merged, so `.agents/` and `.codex/` are protected like `.claude/`.
1. **Phase 1:**
   - **Find a lesson**, the read-only review run and `lesson_drafts`.
   - The card with Accept, Edit and Dismiss, writing to the folder chosen above.
   - Skills in the trust fingerprint, with Accept updating it in the same step. This goes in phase 1 because Accept must not trip the new prompt. On upgrade, a trusted folder's current skills are taken into its fingerprint; they already load whatever the trust state, so this grants nothing new.
   - Remote rules, a guide page and a whats-new row.
2. **Phase 2:** the merged pull request trigger, and Jev's `lesson_check`, observed only.
3. **Phase 3:** `lesson_skills`, usage counting, stale and archive cards, Pin and Restore.

## Decisions

1. **Protect `.agents/` and `.codex/` like `.claude/`.** An agent's write to any skill folder should ask the same way. Done in `spark/protect-agent-folders`; this design depends on it and does not implement it.
2. **Skills count toward the trust fingerprint, and Accept updates it at the same time.** A skill from elsewhere is now visible, and the user's own lesson never asks for re-trust. This is in phase 1.
3. **The automatic trigger is a merged pull request; Find a lesson stays; a quiet period is deferred.** A merge is a strong, rare and cheap signal.
4. **New skills go to `.agents/skills/` when the project's agents read it, else the chat's provider folder.** One folder serves Claude, Z.ai and Codex today, per `discovery.ts` and the Codex adapter.
5. **Archived skills go to Spark's data folder with their original path recorded.** The repo stays clean, and Restore is one click.
6. **An accepted lesson is an ordinary uncommitted change.** It ships with the chat's next commit or pull request and never starts a publish by itself.

## AGENTS.md sentences to update

- The Jev sentence in "Product and stack" ("Jev is an optional decision service used outside turns (the Map, pull request feedback sorting, the companion) …") gains "lesson checks".
- The safety floor's "changing an agent instruction file always asks" must cover `.agents/` and `.codex/`. That edit belongs to `spark/protect-agent-folders`, not here.
- AGENTS.md has no trust sentence, so the fingerprint change goes in `REPO_AGENT_CONFIG.md`, "Fingerprint" (which today leaves skills out) and the guide page that documents "Folder setup changed": skills are part of the fingerprint, and a skill Spark writes on Accept updates it.
- A new bullet:
  - A lesson is a background run outside the turn, queued by **Find a lesson** or a merged pull request.
  - Spark writes the skill only on the user's Accept. The skill is an uncommitted change that ships with the chat's next commit or pull request and never publishes by itself.
  - Archived skills move to Spark's data folder.
