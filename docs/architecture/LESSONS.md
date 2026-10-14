# Lessons from finished chats (design proposal)

Status: proposal, October 14, 2026. Nothing here is built.

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
- **Skill folders.** `agent-config/discovery.ts` scans `.claude/skills`, `.agents/skills` and `.codex/skills`. Claude gets all three through the sanitized plugin built from `scan.skills` (`agent-config/plugin-dir.ts`, `launch.ts`); Codex reads `.agents/skills` and `.codex/skills` itself (`REPO_AGENT_CONFIG.md`). So `.agents/skills` reaches both.
- **Trust does not cover skills.** The trust fingerprint holds hooks, allow rules and MCP servers only (`executableItems` in `agent-config/trust.ts`); skills follow their own per-project switch (`REPO_AGENT_CONFIG.md`, "Fingerprint"). A new skill does not show "Folder setup changed".
- **Protected paths.** `INSTRUCTION_PREFIXES` in `projects/path-policy.ts` is `.claude/`, `.cursor/rules/` and `.spark/`, plus `AGENTS.md` and `CLAUDE.md` by name. An agent's write under `.claude/skills` always asks; a write under `.agents/` or `.codex/` does not today.
- **Drafts the user starts.** Outpost drafts (`persistence/outpost-drafts.ts`, `outposts/story-start.ts`) and agent plans (`workflow/plan-recorder.ts`, `persistence/plan-documents.ts`) live in the database and take effect only when the user acts.
- **Remote.** Every route needs a rule in `remote/route-rules.ts` or the policy test fails. Outpost drafts are readable from a device; starting a story stays on the Mac.

## User flow

1. The chat's ⋯ menu gets **Find a lesson**, which queues a review run for that chat. The run shows its time and cost like any run.
2. With nothing found, one line says "No lesson found". Otherwise a **Lesson** card appears under the last reply: the target ("Patch `.agents/skills/release/SKILL.md`" or "New skill `pnpm-filters`"), a one-line reason, the message it came from, and the diff or new file.
3. **Accept** writes the file; the click is the approval, so no second card appears. **Edit** opens the text in place first. **Dismiss** is kept so the same lesson is not offered again.
4. Settings → Projects lists the skills Spark wrote, with accept date, last seen use, state (active, stale, archived), Pin and Restore.

**Who writes the file.** Spark, on Accept; the agent never does. The file lands in the chat's working folder: its worktree on its own spark/\* branch, or the user's checkout when the chat works there. A chat with no project gets no lesson. The file is an ordinary uncommitted change: it never starts a publish prompt, and later turns treat it like any other kept change.

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
  primary key (project_id, path)
);
```

Drafts stay in the database until accepted. `lesson_skills` records provenance; the curator touches only its rows, never a skill a person wrote.

## Usage counting and the curator

Spark can't reliably see skill use:

- **Claude:** with the `Skill` tool on (`repoTools` in `agents/acp/agents.ts`, behind `repo.skillTool`), each use is a tool event naming the skill. Reliable.
- **Codex:** no skill tool. The only signal is a read of the `SKILL.md` path, a heuristic that a mode the gate can't see may never report.
- **None:** the accept date is the clock.

Proposal: count Claude's `Skill` events, count Codex reads as best effort, fall back to the accept date. A daily worker pass marks a skill stale after 14 days unused (a label only) and after 30 offers an archive card that moves it to `.agents/skills-archive/<name>/`, outside the scanned folders, only when the user confirms. Pinned skills are exempt. These clocks age skills; they limit nothing about runs.

## Triggers, Jev and cost

- **Phase 1 is manual**, which sidesteps the trigger question.
- **Automatic triggers.** Spark has no "finished chat" state; candidates are the pull request merged (its `pr_watches` row reaches `done`), the chat archived, or a quiet period after the last turn. The enqueue is one job insert after `finishRun` (next to `recordKeptChanges` in `chat-turn.ts`), at most one pending review per chat, never run inside the turn.
- **Jev, optional.** One Noul question outside the turn, "this chat holds a reusable lesson", under JEV.md's "Rules for every new use": observed only first as `run_advice` purpose `lesson_check`, acting off by default, a new "Data sent" row, not called with the Spark switch off. Without Jev a rule decides: a correction phrase in the user's messages ("stop", "don't", "never", "always") or a merged pull request.
- **Cost.** Each review is an ordinary run; tokens and cost appear in Usage under its own category. Nothing caps it.

## Claude vs Codex

- New skills go to `.agents/skills/<name>/SKILL.md`, which both agents load.
- A patch edits the file where it is. A `.claude/skills` skill never reaches Codex, so the card says which agents will see it.
- Claude's plugin drops `allowed-tools`, `hooks` and similar frontmatter, and inline `!` shell never runs, so a lesson cannot widen permissions.

## Failure modes

- **Review run fails or is stopped:** one line says no lesson was made, and why.
- **Skill file changed since the draft:** Accept refuses (the `base_hash` no longer matches) and offers a fresh review.
- **Dismissed lesson returns:** past dismissals go into the review as "already declined".
- **Prompt injection in chat text:** the draft is data; the user reads the full text before Accept, and frontmatter is limited to `name` and `description`.
- **Skills switched off for the project:** the card says the skill won't load until the switch is on.
- **Paired device:** reading drafts may be `always`; Accept, Edit, Dismiss, Restore and archive are `never` in `route-rules.ts`.

## Incremental plan

1. **Phase 1:** **Find a lesson**, the read-only review run, `lesson_drafts`, and the card with Accept, Edit and Dismiss writing to `.agents/skills`; remote rules, a guide page and a whats-new row.
2. **Phase 2:** the owner's automatic trigger, and Jev's `lesson_check`, observed only.
3. **Phase 3:** `lesson_skills`, usage counting, stale and archive cards, Pin and Restore.

## Open questions for the owner

1. Should `.agents/` and `.codex/` join `INSTRUCTION_PREFIXES`, so an agent's own write to a skill there asks like `.claude/` does?
2. Should skills count in the trust fingerprint, so a pulled-in skill shows "Folder setup changed"?
3. Which automatic trigger: pull request merged, chat archived, or a quiet period?
4. Is `.agents/skills` the right default, or should new skills follow the chat's provider?
5. Archive into `.agents/skills-archive/` in the repo, or into Spark's data folder?
6. Should an accepted lesson be committed with the chat's kept changes, or stay uncommitted until the user ships?

## AGENTS.md sentences to update

- The Jev sentence in "Product and stack" ("Jev is an optional decision service used outside turns (the Map, pull request feedback sorting, the companion) …") gains "lesson checks".
- If question 1 is accepted, the safety floor's "changing an agent instruction file always asks" must cover `.agents/` and `.codex/`.
- A new bullet: a lesson is a background run outside the turn, Spark writes it only on the user's Accept, and it never publishes.
