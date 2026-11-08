# Week recap

A Home card that tells the user what they got done this week, what is still moving, and where someone could help, written by a model from what Spark already recorded, ready to copy into a message to themselves or a manager.

Developers rarely say what they accomplished; to them it is just the job. Spark sees the chats, the kept changes, the pull requests, the tickets and the cards that waited on someone, so it can say it for them.

## What the user sees

The **Week recap** card on Home, from Friday at 15:00 (a setting) until the next Monday, and on any day after **This week** is pressed:

```
Week recap · Mon 2 Nov – Fri 6 Nov
[For me | For my manager]

Done this week
  Shipped the browser download prompt (PR #182 merged)
  + 6 more · Show all
In progress
  Calendar nudges for clashing meetings (PR #190 open, checks passing)
  + 2 more · Show all
Could use your help
  Release notarization waits on an Apple ID answer
  + 1 more · Show all

┌ editable text ─────────────────────────────┐
│ *Done this week:* Shipped the browser …    │
└────────────────────────────────────────────┘
[Copy] [Copy as plain text] [Refresh]
Written by Claude Sonnet 5.5 · medium · $0.01
```

- One lead item per section; **Show all** lists the rest. A section with nothing says so ("Nothing waiting on anyone").
- **For me** is first person and plain; **For my manager** is shorter and outcome first. Every item carries both wordings from the same model call, so the toggle only switches which one shows.
- The box below is built from the lead item of each section in the chosen voice, under the three labels (Done this week, In progress, Could use your help), as Markdown. The user may edit it before copying; edits are not saved, and switching voice or a refresh replaces them after a confirm when the box was edited.
- **Refine** sits under the box: the user types what to change ("shorter", "say the release is blocked on Apple", "less technical") and the model rewrites the box's current text, edits included, in the chosen voice. Each refine is one run on the same model (`digestModelFor`, medium effort) with the week's facts, the current text and the instruction; the instruction is the user's own and the facts and text are marked as data. The reply replaces the box, **Undo** puts the previous text back, and refining again builds on the new text. A pull request number or ticket key in the reply that no fact holds is removed from the reply before it is shown. Refines are kept with their recap (instruction, text in and out, cost), so a reload shows the latest refined text for each voice.
- **Copy** copies Markdown; **Copy as plain text** strips it. Nothing is sent anywhere. Slack is unchanged.
- Totals ("8 chats, 5 pull requests merged, 3 tickets moved") come from counted facts, never from the model.

## Week and schedule

- The week runs from Monday 00:00 local time to now. The recap is due on the chosen day and time (Friday 15:00 by default); before that, Home shows no card and the brief's settings area offers **This week**.
- One scheduled recap per week, claimed in `profiles.week_recap_tried_on` the way the morning brief claims its day, skipped while Spark is paused or the recap is off. **Refresh** writes a new one; at most one runs at a time.
- Settings sit under the morning brief's setting (Settings → Notifications): **Week recap** on or off (on), **Day** (Friday) and **Time** (15:00).

## Facts

Gathered by `recapRows` (`apps/server/src/persistence/recap-facts.ts`) and turned into facts in `apps/server/src/recap/facts.ts`, chats only (Terminal sessions, and ticket events from them, come later), for the workspace's visible chats with a turn in the week, archived ones included. Each fact has an id (`c1`, `p3`, `t2`) so the reply can cite it, and the numbers and keys it may name (`refs`):

| Kind                   | From                                                                                                                       | Section it suggests                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| chat                   | up to 25 chats: title, project, turns, failed turns, kept changes, files changed, last reply line; refs found in that text | any                                                            |
| pull request merged    | `pr_watches` with `pr_state='merged'` and `merged_at` (set when Spark first sees the merge) in the week                    | Done                                                           |
| pull request open      | `pr_watches` with `pr_state='open'`: title, draft, checks, review, age                                                     | In progress, or Could use your help                            |
| ticket moved or linked | `ticket_events` `outcome='succeeded'` in the week, with the ticket's current status                                        | Done when done, otherwise In progress                          |
| waiting on you         | a pending card in a chat on the list                                                                                       | For me only, as "Waiting on you"; never in Could use your help |

Totals are counted by their own query, so the limits on facts (25 chats, 30 pull requests, 25 tickets) never lower them. No calendar data, no file contents, no commands. Text is redacted and clipped, and the facts block is capped at 16,000 characters (`fittedFacts`).

## Model

- `digestModelFor` on the user's default provider: the middle tier at medium effort, top tier when there is none (the same choice the brief and plugin review use).
- A hidden conversation (`kind='digest'`, title "Week recap") and a run with `role='digest'`, so it stays out of analytics, outcomes and the chat list. The conversation, message, run and job are inserted by one helper (`persistence/hidden-runs.ts`) that the brief, plugin review and the recap share. The worker dispatches recap runs before `isDigestRun`.
- One call. The prompt holds the facts and asks for JSON: for each section an ordered list of items `{ me, manager, facts: [ids] }`, most important first. The reply is parsed in `recap/parse.ts`: an item citing no known fact is dropped, an item whose text names a pull request number or ticket key that none of its cited facts holds is dropped, and the totals line is built from counted facts, never from the reply. A reply that does not parse fails the recap with "The recap could not be written. Try again."
- The cost and model label are shown on the card as the brief shows them, refines included.

## Storage

Migration `0231_week_recaps.sql` (and `0232_pr_merged_at.sql`, which adds `pr_watches.merged_at`):

- `week_recaps`: `id`, `workspace_id`, `conversation_id`, `run_id`, `status` (`running`, `ready`, `failed`), `week_start` (date), `since`, `until`, `facts` jsonb, `body` jsonb (sections, `me`, `manager`), `model`, `model_label`, `error`, `created_at`, `finished_at`.
- `profiles`: `week_recap_enabled` (true), `week_recap_day` (5), `week_recap_time` ('15:00'), `week_recap_tried_on` (date).
- `week_recap_refines`: `id`, `recap_id`, `run_id`, `voice` (`me`, `manager`), `instruction`, `text_in`, `text_out`, `status`, `error`, `created_at`, `finished_at`, with one running refine per recap.
- A partial unique index on `(workspace_id) WHERE status = 'running'` keeps one recap running at a time; a second request returns the running one.
- Recovery is the brief's: a recap still `running` reads as failed once its run ended without finishing it or after the brief's stale limit, decided when it is read, so a run that resumes after a restart still finishes it.

## Routes

`GET /api/home/recap` (the latest recap for this week with its latest refines, whether one is due, whether a provider is set), `POST /api/home/recap` (write one now) and `POST /api/home/recap/:id/refine` (`{ voice, text, instruction }`), each with the same `route-rules.ts` rule as `/api/home/digest`. The settings are profile fields (`weekRecap`, `weekRecapDay`, `weekRecapTime`) saved through the profile update the morning brief uses, so they follow its rule.

## Not in phase 1

Terminal sessions, Slack, sending or scheduling a message, saving edits, history of past weeks, a Spark tool.
