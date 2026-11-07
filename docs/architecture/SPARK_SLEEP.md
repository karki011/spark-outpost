# Spark Sleep (plan)

> **Status: plan, not built (November 6, 2026; revised November 7).** Nothing here is implemented. The proposal was revised after the prototype tests below: notes are matched to each request instead of sent as a fixed preamble, every note is fact-checked before it is kept, and consolidation prefers stable conventions. It applies the ideas of "Language Models Need Sleep" (arXiv 2606.03979, Google Research) to Spark, without training any model.

## The paper in one page

The paper treats a deployed model as having short-term memory (the context window, fast-changing parameters) and long-term memory (slow-changing parameters), with nothing that moves knowledge from one to the other. It adds an offline **sleep** phase with two stages:

1. **Consolidation.** Before a fast memory block is overwritten, its knowledge is distilled into the next slower block. Three moves:
   - **Expansion:** a new small expert is added to the slower block, so new knowledge gets new room instead of overwriting old knowledge.
   - **Seeding:** the model before the update is the teacher and the model after it is the student. Only the new expert trains, and it must keep matching the teacher's behaviour (distillation plus an imitation reward).
   - **Pruning:** the fast block's temporary experts are reset once their knowledge has moved.
2. **Dreaming.** The model generates its own practice material from a task's context, scores each sample by how much it would change the model (a gradient-based importance score), and keeps the top k plus some random ones for diversity. A sample earns reward 1 only if training on it improves performance on the task, and 0 otherwise.

Results, as reported:

- **Knowledge incorporation (SQuAD, no context):** 48.9 with sleep, against 46.7 for SEAL and 31.9 for the base model.
- **Few-shot ARC:** 80%, against 72.5% for SEAL and 0% for in-context learning.
- **Math (Qwen3-8B, AIME-24):** 79.2, against 73.8 for the base model and 76.4 for GRPO.
- **Cost:** at the same number of steps, plain fine-tuning is 4x cheaper. Trained to the same math scores, fine-tuning takes 3.6x to 4.8x the wall-clock time of sleep.
- **Not read as numbers:** the class-incremental, long-context and BABILong results appear only in figures, so this summary gives their direction, not their values. Hope with sleep is reported best on each.

**Ablations.** Every part helps. **Dreaming matters most for learning new knowledge:** without it, SQuAD drops to 35.7, about 12 to 13 points below the full method. Imitation matters most for math reasoning.

**Limits the authors name or imply:**

- Repeated self-improvement can cause forgetting.
- Dreams sampled only from existing knowledge don't find new ideas.
- Each consolidation costs extra forward passes.
- The paper gives no dreaming prompt and no hyperparameter values for its distillation loss.

## What carries over to Spark

Spark doesn't train weights, and agents run through Claude and Codex. The structure still maps cleanly:

| Paper                      | Spark                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wake                       | Chats and turns: messages, tool steps, the Kept record, outcome signals, pull request reviews.                                                                     |
| Short-term memory          | A chat's own context. It is lost when a chat is archived or compacted, and other chats never see it.                                                               |
| Long-term memory           | **Project notes**: short, sourced facts about a project that every new chat in that project can use.                                                               |
| Expansion                  | New notes are added beside old ones, never merged into them blindly.                                                                                               |
| Seeding (teacher, student) | The current notes are the teacher. A proposed note set is accepted only if it keeps every fact the old set answered, unless a newer source contradicts that fact.  |
| Pruning                    | Retire notes whose cited files or symbols are gone, that a newer note supersedes, or that have gone unused for a long time.                                        |
| Dreaming                   | Make practice questions from past requests in the project, answer them with and without the notes, and keep a note only if it helps.                               |
| Importance score           | Prefer episodes with strong outcome signals (corrections, re-asks, reverted changes, review comments, merged pull requests), plus a few random ones for diversity. |

The ablation is the most useful lesson: **the check is not optional.** A summarizer that writes notes nobody verifies is the "no dreaming" row, roughly 13 points worse in the paper. Spark Sleep aims to keep a note only when evidence shows it helps. Phase 1 checks that each note is true (a fact check against the code before it is kept), not that it helps; the holdout measures notes per project, not per note. The per-note "does it help" check is phase 2's dreaming.

## Proposal

### What a note is

- **Content:** one or two sentences about one project: a convention, a gotcha, where something lives, a decision and its reason, or a command that works. Stable conventions are preferred over what a recent change did, which the prototype found goes stale or never helps the next request.
- **Cites:** at least one source, a run (chat turn) and, where it applies, a file path or symbol. A note with no source is never stored.
- **Stored in:** a `project_notes` table holding the project, the text, the sources, the cited paths, the created date, the last verified date, the use count, the state (`active`, `retired`) and the reason it was retired.
- **Shown in:** the project's page as a list the user can read, edit, pin, retire and delete. It is never hidden.

### The sleep job

The job runs per project, outside any turn, through the same gate as the project map: it pauses while any run is queued or running, and it runs when the Mac is idle or at night. It has five steps, each with a pure decision core and its effects at the edges.

1. **Gather (rules only).**
   - Take turns finished since the last sleep in chats of that project.
   - Skip Ask Spark, Terminal sessions without recording, and turns that read a secret file or a `.sparkignore` file.
   - In phase 1, also skip every turn that read untrusted content, or whose session did earlier (a live or resumed session keeps what it read, so a later turn can repeat it without reading again). The run records the first untrusted read per session, and every later turn in that session counts as having read it. Untrusted content means the Browser pane, WebFetch or WebSearch, tickets, Atlassian, ServiceNow, Slack, calendar, MCP results, Mac control and untrusted attachments. One page an agent read once must not plant a note that steers every later chat. Asking the model to keep only facts about the code is not a control.
   - Rank the turns by outcome signal strength and keep the top k plus b random ones. This is the paper's importance score, with outcome signals in place of gradients.

2. **Consolidate (one model run, a child run like the morning digest, read-only).**
   - Input: the chosen turns' messages and kept-file summaries, plus the current notes.
   - Output: proposed adds, edits and retirements, each citing its sources.
   - Prompt: keep facts that will still hold next month (commands, rules, where things live, why a decision was made) and leave out summaries of what a turn changed.
   - Model: the cheapest model the project's default provider offers that is good enough to write project instructions (`digestModel` picks this way today).
   - Scrub secret values from the input and the output.
3. **Verify.**
   - **Citations (code, no model):** every cited path and symbol must still exist in the project (`git ls-files`, `git grep`). This checks citations, not facts: a wrong command can cite a real file.
   - **Facts (one read-only child run per note, read tools only, on the project's current commit):** the agent reads the cited files and searches as needed, and answers true, stale or unsupported. Only true notes are kept. In the prototype, half the proposed notes failed this check and most were wrong when written, not made stale later.
   - The fact check is strict and sometimes rejects a true note. A rejected note is listed on the project page as rejected, with the reason, and the user can keep it by hand, which pins it.
   - Each kept note records the commit it was checked at. A later sleep checks it again when any cited file has changed since then.
   - An edit or retirement must point to a newer source that contradicts the note it replaces. A newer source about the same file is not enough, since two facts can cite one file. This is the teacher rule: an old fact survives unless something newer says otherwise. When contradiction isn't clear, both notes are kept and the project page asks the user.
4. **Dream (phase 2, one more model run).**
   - From the gathered requests, write a few practice questions about the project ("where is X configured?", "what must I run before committing?") and answer each twice, once with the proposed notes and once without.
   - Answers are checked against the repository (do the named files exist, does the quoted line exist), not by asking the model whether it did well.
   - A proposed note that no question used, or that made an answer wrong, is dropped.
5. **Apply.**
   - Accepted changes are saved, and each is one line in the project's history: "Sleep added 3 notes, retired 1".
   - A pinned or user-edited note is never changed by sleep. Sleep may propose a change and show it to the user.

### How chats use the notes

Jev is never called inside a turn, and recall must not add a model call, so recall is a plain search:

- **Each turn gets only the notes that match its request.** Spark matches the user's message against the project's notes in the database (cited paths and symbols named in the message, then a full-text match on the note text) and adds the best few to that turn's preamble, labelled as notes that grant nothing, the same way outpost instructions are. Pinned notes are always added. A request that matches nothing gets no notes. The prototype showed why: a fixed set of notes almost never touched what the next request was about.
- **Size:** the matched notes are held to a fixed number of characters, so they leave room for the conversation and the reply. Notes beyond it stay searchable through `spark_project_notes`.
- **No stale notes are shown.** A note whose cited files changed since it was checked is left out until a sleep checks it again. This is a git comparison, not a model call.
- **Changes:** the notes go with the turn, not the session, so a change needs no session reopen. When a note the session already saw has been edited or retired, the next turn that matches it carries the new text, or a line saying it was retired, marked as replacing the earlier one.
- With **Project notes** off, no notes are added and the tool is not offered.
- **A new Spark tool, `spark_project_notes`**, lets the agent search the rest of a project's notes when it needs them. It is read-only and follows the agent's mode like other reads.
  - It is offered only in a chat linked to a project with **Project notes** on, which keeps the plain-chat tool list (about 2 characters under its 27,000 cap) unchanged.
  - Turning notes on or off changes the offered tools and reopens a live session, as any tool change does.
  - Ask Spark doesn't get it in phase 1.
- A note's use count goes up when the agent reads it through the tool or when a turn it was matched to ends with a positive outcome. Pruning uses this count.

### Where Jev helps (only when connected, never inside a turn)

Jev is a cheap classifier with calibrated probabilities ($0.042 per million input tokens, free output). It fits the yes-or-no steps of the sleep job, with a rules fallback for every question, as the map does today.

| Step        | Jev question                                                                            | Rules fallback                        |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| Gather      | Noul per turn: "this turn taught something reusable about the project".                 | Outcome-signal ranking only.          |
| Consolidate | Noul per proposed note against each close existing note: "A is superseded by B".        | Keep both and ask the user.           |
| Verify      | Noul: "the note is a specific, checkable fact, not advice that applies to any project". | The fact check alone.                 |
| Prune       | Choice per stale note: keep, rewrite, retire.                                           | Retire when every cited path is gone. |

Every Jev answer is validated and recorded with its policy version, as JEV.md requires. It acts only above a threshold tuned on labelled data (a threshold report is planned, not built yet), and is recorded as observed-only until then.

### Safety

- **Notes are data, never authority.** A note can't authorise a push, a pull request, a Spark action or a mode change, and the preamble says so.
- **What's left out:**
  - Phase 1 skips every turn that read work data or other untrusted content (pages, tickets, Slack, MCP results). Later phases keep excluding them until an enforceable replacement control is specified; asking the model to keep only facts about the code is not one.
  - Turns that read a secret file are skipped entirely.
- **The fact check is read-only.** It is a child run with read tools only, outside any turn, on the project's own files.
- **Never in a note:** secret values. The input and the output are scrubbed, and a note that still holds a secret-looking value is dropped.
- **Off by default.** The setting is per project (**Project notes**, off), with **Sleep now** on the project page. The cost of each sleep is shown with the run, as Spark shows every cost, with no limit.
- **Paired devices** can read notes and nothing else: no editing and no **Sleep now**. The read route needs its own rule in `route-rules.ts`.
- **Instruction files.** Sleep never edits `CLAUDE.md`, `AGENTS.md` or another instruction file. A note the user wants there is copied by the user, or by an agent through the usual instruction-file card.

### Measuring whether it works

The paper's reward is "1 if performance improves". Spark already records outcome signals per turn, so:

- Hold back a random 20% of chats (not turns) in each project with notes. A held-back chat gets no matched notes and no `spark_project_notes` tool for its whole life, resumed sessions included, so it can't use notes from an earlier turn or a search.
- Compare corrections, re-asks, reverted changes and checks failed between turns with notes and without, per project, in Analytics.
- If notes don't beat no notes after a fair sample, say so on the project page and suggest turning them off.

## Prototype test (November 7, 2026)

A throwaway script ran the gather, consolidate and verify steps, plus a with-and-without check, on this repository's own Claude Code history. Spark's dev database held only 2 chats.

- **Data:** 466 typed requests from October 13 to November 7. Notes were made from those before October 23, and test questions came from those after.
- **Gather:** 297 requests before the split. 17 were dropped as untrusted and 34 for reading a secret file (mostly sourcing `.local/credentials.env`). 150 of the remaining 246 were chosen.
- **Consolidate:** one Haiku call proposed 43 notes for $0.02. 41 passed the path check.
- **Test:** 29 later requests whose changed files still exist. For each, a model with no tools listed the files it expected to need. It was given the repository's directories plus nothing, the notes' cited paths only, or the full notes.

| Answer model             | Context    | Exact files | Right folder | Made-up paths |
| ------------------------ | ---------- | ----------- | ------------ | ------------- |
| Haiku (2 runs, averaged) | Nothing    | 2%          | 9%           | 34%           |
|                          | Paths only | 2%          | 14%          | 13%           |
|                          | Full notes | 2%          | 15%          | 16%           |
| Sonnet                   | Nothing    | 3%          | 8%           | 16%           |
|                          | Paths only | 3%          | 13%          | 6%            |
|                          | Full notes | 3%          | 18%          | 14%           |

What it showed:

- **Notes cut made-up paths and pointed to the right folder more often, but a bare list of the same paths did almost as well.** The sample is small and the test has no tools, so it measures orientation, not finished work.
- **The path check is too weak.** At least four of the 41 kept notes were stale when tested, and all passed because their files still exist. Examples: Atlassian deletes asking every time, Terminal recording being off by default, Ask Spark being read-only, and Calendar phase 1 being read-only. One note cited a file that has nothing to do with it.
- **Consequences for the plan:**
  - Verify needs a fact check against the current code and docs, not only path existence. This matches the paper's ablation.
  - Phase 2's dreaming check should come before notes are shown to agents, not after.
  - A fair test needs real turns with tools, measuring steps, time and corrections, which spends real usage.
- **Cost:** about $12 in all, $11.20 of it for the one Sonnet answer run.

### Second test: fact check and real turns

- **Fact check:** a Haiku agent with read tools checked each of the 41 notes against the current code and docs. It judged 12 true, 20 stale and 9 unsupported, for $0.20. A hand check of 11 verdicts agreed with 8, including the stale Atlassian deletes, Terminal recording and `gh workflow run` notes. The checker was too strict in places: it rejected true notes, such as the shared attention state, when the cited file didn't say the fact outright.
- **Stale, or wrong from the start?** The 20 stale notes were checked again against the code of October 24, just after the work they came from. Only 5 were true then (11 stale, 4 unsupported, $0.11). Most were wrong when consolidation wrote them, not made stale later.
- **Real turns:** 24 later requests each ran as a Haiku agent with read tools, on the repository as it was when the request was made. The agent named the files it would change. Each ran three times without notes and with the 12 checked notes, and twice with all 41.

| Context          | Right files (runs) | Average | Right folder | Agent steps |
| ---------------- | ------------------ | ------- | ------------ | ----------- |
| Nothing          | 21%, 13%, 21%      | 18%     | 23%          | 11.1        |
| 12 checked notes | 17%, 17%, 19%      | 18%     | 24%          | 10.3        |
| All 41 notes     | 17%, 17%           | 17%     | 26%          | 10.4        |

- **This history can't test the idea.** Only 1 of the 24 later requests touched a file any note mentioned, and none touched a file a checked note mentioned. Work moved on to new areas, so no result here could show a gain. The equal scores are expected, not evidence that notes don't help.
- **Noise:** the spread between runs without notes (13% to 21%) is larger than any difference between conditions.
- **Cost:** about $1.65.

What this means for the plan:

- The write-time check matters most: most rejected notes were wrong when written. Verify needs a fact check against the code before a note is kept, not only the path check. This is the paper's lesson again.
- Lasting value is more likely in notes about stable conventions (commands, rules, where things live) than in notes about recent changes. Consolidate should be told to prefer those.
- A positive result needs a slower-moving project or a longer history than this one gives.

## Phases

1. **Phase 1:** the table, the project page list (with rejected notes), the gather, consolidate, verify (citations and the fact check) and apply steps, per-request matching, `spark_project_notes`, the setting, the guide page and the holdout measurement. Jev is not used yet.
2. **Phase 2:** dreaming (practice questions answered with and without notes, checked against the repository).
3. **Phase 3:** the Jev questions above, observed-only first and then acting once tuned.

## Open questions

- **Are matched notes a work-data read?** Notes come from other chats, and AGENTS.md counts lists across chats as work data for the send flag. Either a turn that got notes counts as having read work data, so a later send carries the flag, or notes are treated as Spark's own data about the project, which phase 1's skipping of untrusted turns supports. This is the user's decision.
- **The holdout.** With one user, a 20% holdout gives small, noisy samples, and those chats run without notes on purpose.
- **Is matching good enough?** A word match misses requests that describe a file without naming it. If it misses too often, a local embedding index is the next step, still with no model call inside a turn. Should it be on, and should those turns say so?

- Should notes be shared across projects for one user (for example "always uses pnpm")? Not in phase 1. Those belong in the user's own instruction files.
- Codex has its own memory features and Claude Code has auto-memory. Should Spark read them as extra episodes? Not in phase 1, since Spark reads no user memory files today.
- Should a long chat be consolidated before it is compacted, to match the paper's "consolidate before the fast block is overwritten"? Likely in phase 2. Compaction already writes a summary that the gather step could use.
