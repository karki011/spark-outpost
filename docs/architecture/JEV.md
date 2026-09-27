# Jev

Researched on September 25, 2026 from the TypeSafe docs (https://docs.typesafe.ai/llms.txt).

## What it is

Jev is TypeSafe's "System One" model. It takes a `state` (text or JSON) and typed questions, and returns typed answers with calibrated probabilities (https://docs.typesafe.ai/introduction):

- **Choice:** one option from up to 255.
- **Score:** a level on a rubric.
- **Noul:** the probability that a statement is true.

Jev is not a chat or coding LLM. It doesn't generate text, stream, call tools, or edit files (https://docs.typesafe.ai/introduction/coding-agents). It has no OpenAI- or Anthropic-compatible endpoint, no CLI, and no ACP support. The "agent skill" is only documentation for coding agents.

## Role

- **(a) Chat provider: no.** Nothing in the API can answer a chat.
- **(b) Router: observed only since round 10.** Routing is a documented pattern (https://docs.typesafe.ai/patterns/intent-routing, https://docs.typesafe.ai/patterns/confidence-routing), but rules-only routing was cheaper at the same pass rate, so the rules pick the model and Jev's tier pick is recorded for comparison. Jev acts only on the intake questions listed below.

## API

- **Auth:** `Authorization: Bearer <key>`, with keys from https://console.typesafe.ai/keys. The key format isn't documented, so the app checks nothing locally.
- **Base URL:** `https://api.typesafe.ai`, configurable as `TYPESAFE_BASE_URL` (the SDK's own variable, https://docs.typesafe.ai/sdk/javascript/api/variables/ENV).
- **`GET /v1/models`:** returns `{ models: [{ name, description, release_date }] }` and spends no tokens. The connection check uses it (https://docs.typesafe.ai/models#listing-models).
- **`POST /v1/systemone`:** takes `{ state, model, questions }` and returns `{ model, answers, usage }` (https://docs.typesafe.ai/api).
- **Errors:** 401, 422, 429, and 529.
- **Models:** `jev-latest` and `jev-preview`. Input is text only, up to 64k tokens.

## Cost

The price is $0.042 per million input tokens. Output tokens are free (https://docs.typesafe.ai/models). Responses report tokens, not cost. One routing call is a few hundred to a few thousand tokens, well under $0.0001. Verifying a key spends nothing. Jev gets no "Send test message", because a test would be billed.

## Round 10: what Jev does now (September 27, 2026)

Jev answers a few concrete questions per Do turn, observes routing, edits and diffs, and never grants anything. The flow is in [HARNESS_PLAN.md](HARNESS_PLAN.md#current-architecture-the-lean-harness-round-10-september-27-2026). Everything after the "Data sent" table below is dated history.

### Questions in use

| Key                                                                              | Type                                                                     | When                                                         | Acts on                                                                              | Line (`advisor/policy.ts`, `lean-2`)                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `question`                                                                       | Noul                                                                     | Do                                                           | answer in place, read-only                                                           | yes at 0.8 or more, no at 0.2 or less                                                                 |
| `vague`                                                                          | Noul                                                                     | Do, first message                                            | the "What should change?" card, or "Assumed you meant"                               | same band                                                                                             |
| `review`                                                                         | Noul                                                                     | Do                                                           | a Critic                                                                             | same band, else the review phrase rule                                                                |
| `destructive`                                                                    | Noul                                                                     | Do                                                           | the top tier, a Critic, a worktree copy; the larger of Jev and the keyword rule wins | same band                                                                                             |
| `continues_task`                                                                 | Noul                                                                     | Do, with a task to continue                                  | resume the task session or start a new task                                          | same band, else the follow-up rule                                                                    |
| `injection`                                                                      | Noul over attached text                                                  | attached text only                                           | recorded only                                                                        | —                                                                                                     |
| `intent`                                                                         | Choice                                                                   | always                                                       | the category chip, clarify readings                                                  | category stored at 0.5                                                                                |
| `tier`                                                                           | Choice (small, mid, top of the chat's provider)                          | Do and Ask                                                   | **observed only**: "Jev would have used …"                                           | 0.9 recorded, never applied                                                                           |
| `policy`: `beyond_request`, `destroys_work`, `weakens_tests`, `unsupported_file` | 4 Nouls, bad = true                                                      | each proposed edit with a diff                               | **observed only**: max ≥ 0.85 would block, ≥ 0.5 would ask                           | missing or invalid → review                                                                           |
| `verify`: `unmet_1…5`, `weakens_tests`                                           | Nouls, bad = true                                                        | after each Builder turn that changed files                   | **observed only**: max ≥ 0.8 would flag                                              | missing or invalid → review                                                                           |
| `likely_file` (`rank`)                                                           | Choice over up to 255 candidate files                                    | Do with a code scan                                          | **observed only**: the predicted files                                               | files ordered by probability, the first 12 kept                                                       |
| `route` (`route_shadow`), text-only and with code evidence                       | Choice over the connected Do models (neutral tier each) plus `uncertain` | Do with a code scan, on Auto, not destructive, 2+ candidates | **observed only**: logged next to the rule route                                     | top option at confidence 0.65, else the cheapest tier reaching 0.8 cumulative; uncertain → chat model |

- **One act line per question, at every level.** The involvement level only decides whether an unsure answer asks you (Hands-on, Balanced) or falls back to the rules (Hands-off, Full auto).
- **Validation before branching.** The key must be present, the type must match, a Choice must be one of the offered options, and every value must be finite and between 0 and 1. A failed intake answer falls back to the rules for that question; a failed policy or verifier answer counts as review. Only 429 and 529 are retried, once.
- **Distinct options.** Each `intent` option has `what` and `not_for`, so neighbouring categories (Bug fix and Debugging, Question and Research) do not split probability. The tier options say what each size is for and not for, with the model's card line.
- **Thresholds are provisional** until tuned on our own labelled data: the observation rows plus the outcome signals. `pnpm jev:thresholds` prints precision and recall per threshold. Promotion to acting follows JEV_OPPORTUNITIES rule 7.
- **Records.** Every Jev row stores `policy_version` and the model version that answered (`jevModel`).
- **Removed:** routing that acted (provider, model and effort picks and their gates, the frontier gate), transitions, step checks, the watchdog, parallel and lane questions, the build-style choice, and the complexity, risk, depth, scope and mechanical intake questions. See [HARNESS_PLAN.md](HARNESS_PLAN.md#removed-in-round-10).

## Data sent

Every free-text field is passed through the audit log's secret redaction (`redactText`) before it is sent. Exactly what each call sends to TypeSafe since round 10:

| Call (`run_advice.purpose`)   | When                                                               | `state` sent                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake (`intake`)             | Once per turn                                                      | `task`: the new message only, 8,000 characters at most; `mode`. With a task to continue: `previous_request` (2,000 characters) and `task_summary` (the task's last reply, 1,000 characters). `untrusted`: the text of files attached to the new message, 8,000 characters in total, no file names, only for the `injection` question. The `tier` options carry each model's card line. |
| Edit gate (`policy`)          | Each proposed edit with a diff, observed only                      | `request` (4,000 characters), `path` (the target file), `diff`: a unified diff of the proposed edit, 24,000 characters at most. Only while "Send code diffs to Jev for safety checks" is on.                                                                                                                                                                                           |
| Verifier (`verify`)           | After each Builder turn that changed files, observed only          | `request` (4,000 characters) and `diff`: the change so far, 24,000 characters at most; the requirement lines ride in the question instructions. Only while the setting is on.                                                                                                                                                                                                          |
| File ranking (`rank`)         | Each Do task with a code scan, observed only                       | `request` (4,000 characters, beginning and end kept) and `code_evidence` (index size, named symbols with their reference counts, uncommitted count). The options are the scan's candidate file paths with package, why they matched, line, symbol and reference counts and churn. No file contents.                                                                                    |
| Shadow route (`route_shadow`) | Each Do task with a code scan on Auto, observed only, two requests | `request` (4,000 characters, beginning and end kept), `last_failing_check` for a follow-up (1,000 characters of the failing commands' output), `prior_turns` (the last two, 600 characters each). The evidence request adds `code_evidence`: the ranked files with their numbers and the packages they touch. About 3,000 tokens of state at most.                                     |

- **The setting.** Settings → AI providers → "Send code diffs to Jev for safety checks", on by default (`profiles.jev_diffs`). Its disclosure: diffs and file paths go to TypeSafe for observation-only checks that never block or allow anything, and TypeSafe does not train on them. Off: no diff is sent, and the `policy` and `verify` rows say "skipped: diffs off".
- **Never sent:** the chat history beyond the previous request, the task summary and the shadow route's two prior turns, image attachments, tool and command output other than a follow-up's failing check output, project names and credentials. Diffs and file contents are sent only by the two observation checks above.
- `advisor/intake-questions.test.ts`, `advisor/noul-requests.test.ts`, `advisor/policy-gate.test.ts` and `advisor/verify-questions.test.ts` pin the exact `state` and question keys, so any new field is a visible change.

TypeSafe doesn't train on customer data. Zero data retention is enterprise-only (https://docs.typesafe.ai/legal).

The key lives only in the OS keychain (`jev:api_key`). The database and the UI see only a masked `…abcd`.

## Phase 1 (implemented)

- **Setup:**
  - `jev` is an `AdvisorId`, not a `ProviderId`, so chats, runs, and the composer are unchanged.
  - It is listed in `SetupState.advisors` and stored in `advisor_connections` (migration `0007`).
- **UI:** a Jev card under "Optional routing" in onboarding and Settings, built on the shared card components. It offers an API key tab only.
- **Advisor code** (`apps/server/src/advisor/`): phase 1 had an `Advisor` interface with a `route` Choice over `provider: model` options and `review`/`reviewer` questions. S2 replaced it with the intake below; M5 adds the review questions back to the same question module.

## S2: intake and model routing, recorded only (implemented September 26, 2026)

Nothing Jev says changes what runs. Dispatch still uses the chat's settings.

- **One batched call** (`apps/server/src/advisor/intake-questions.ts`, the only place questions are defined):
  - `intent`: Choice over the turn categories (see below); stored intents from before categories read as explain → question and fix → bug fix
  - `complexity`: Score over four levels (trivial to complex)
  - `risk`: Score over read-only, edits, multi-file, destructive
  - `depth`: Choice over direct, execute, plan_execute, plan_execute_review
  - `injection`: Noul over `state.untrusted` only (attached text), asked only when there is attached text. The user's own message is never judged.
  - `provider`: Choice over the connected providers, asked when more than one is connected
  - `model_<provider>`: Choice over that provider's real models from its capability snapshot (the `default` alias is left out when real models exist)
  - `effort_<provider>`: Score over that provider's real effort levels (from capabilities, else the catalog)
- **Validation.** Every answer is checked against what was offered: an unknown choice, a score outside the levels, or a missing answer fails the call with a clear `jevError`.
- **Confidence.** Intake confidence is the weaker of `intent` and `depth`. Model-pick confidence is the weaker of `provider` and `model`. They are gated separately, because the provider choice between two capable agents is often close to a coin flip.
- **Gate.** `gate(answer, risk, level)` in `apps/server/src/advisor/gate.ts` returns act, ask, or fallback:
  - act at 0.9 or more, or 0.75 or more when the work is read-only (Ask and Chat runs are always read-only)
  - below 0.5, fall back to the fixed rules
  - in between, ask when confidence is below the level's clarify line (hands-on 0.75, balanced 0.6, hands-off 0.5); otherwise act. Full auto never asks, so the rules decide in between.
- **When.** In S2 the worker started intake right after `RUN_STARTED`, next to the provider's cold start, without awaiting it, and recorded `timed_out` after 10 s. Since the orchestrator it awaits intake for at most 3 s before choosing the depth. The fixed-rules answer (`ruleAdvisor`: the chat's provider, model and effort, `direct` for Chat and Ask, `execute` for Do) is always computed, also when Jev is not connected.
- **Storage.** `run_advice (run_id, purpose, jev_status, jev_input_tokens, jev_cost_usd, body)` (migration `0017`). The body is the `advice` artifact (`adviceBodySchema` in contracts): state and questions sent, raw answers, the parsed Jev intake, the rules answer, both gates, what it would do (use Jev, ask, or rules), the fields where Jev differs from the rules, latency, and usage. `run_artifacts` is keyed per task and chat runs have no task, so advice is keyed per run.
- **Live event.** While the run holds its lease, an `ACTIVITY_SNAPSHOT` (`messageId` `artifact:advice`, `activityType` `advice`) carries the summary and the web refetches the chat. Advice that lands after the run ended is inserted without an event. Rules-only rows emit nothing.
- **Cost.** Jev reports `usage.input_tokens`; cost is estimated at $0.042 per million input tokens and labelled estimated. If a response has no usage, tokens are estimated from the request size and labelled so.
- **UI.** A muted line under each turn: "Jev suggested Sonnet 5 · medium · plan → execute · 0.81". Hover or focus shows intent, complexity, risk, injection, both confidences with what they would do, the fixed rules' answer and the differences, latency, and cost. A failed call reads "Jev unavailable · used the fixed rules". With Jev disconnected nothing shows. Jev's cost is its own line in the chat's context popover, the work panel's Cost tab, and Settings → Usage.
- **Auto.** Chats store `model_routing` (`pinned` or `auto`). With Jev connected, the model picker offers "Auto": the button reads "Auto · Sonnet this turn" once an orchestrated run has started, and a pinned model shows "Auto would have used Haiku" when the engine records a different pick.

### Live results (September 26, 2026, `jev-1.13.0`, the user's key)

Eight real intake calls with Claude (Opus 5.5, Fable 5.1, Sonnet 5, Haiku 4.5) and Codex (6 Astra, 6 Sol, 6 Luna) connected, level balanced. The rules would have run Claude · Sonnet 5 · medium for every sample. Run with `pnpm test:live apps/server/test/jev-intake.live.test.ts`.

| Sample                     | Mode | Intent   | Complexity (0–3) | Risk        | Injection | Depth                   | Model pick                 | Intake conf. | Model-pick conf. | Would                     | Latency | Input tokens | Cost       |
| -------------------------- | ---- | -------- | ---------------- | ----------- | --------- | ----------------------- | -------------------------- | ------------ | ---------------- | ------------------------- | ------- | ------------ | ---------- |
| question                   | ask  | explain  | 0.91             | read-only   | —         | direct                  | codex · 6 Luna · low       | 0.82         | 0.07             | use Jev; model fallback   | 355 ms  | 1467         | $0.0000616 |
| typo fix                   | do   | fix      | 0.01             | edits       | —         | execute                 | claude · Haiku 4.5 · low   | 0.98         | 0.17             | use Jev; model fallback   | 182 ms  | 1472         | $0.0000618 |
| multi-file refactor        | do   | refactor | 2.15             | multi-file  | —         | plan → execute          | claude · Sonnet 5 · medium | 0.40         | 0.44             | fall back; model fallback | 180 ms  | 1476         | $0.0000620 |
| destructive migration      | do   | refactor | 1.63             | destructive | —         | plan → execute → review | codex · 6 Sol · medium     | 0.44         | 0.21             | fall back; model fallback | 152 ms  | 1472         | $0.0000618 |
| injection in attached file | do   | chat     | 0.86             | edits       | 0.99      | direct                  | claude · Haiku 4.5 · low   | 0.70         | 0.40             | use Jev; model fallback   | 229 ms  | 1599         | $0.0000672 |
| chit-chat                  | chat | chat     | 0.04             | read-only   | —         | direct                  | claude · Haiku 4.5 · low   | 1.00         | 0.86             | use Jev; model act        | 198 ms  | 1458         | $0.0000612 |
| feature                    | do   | feature  | 1.69             | edits       | —         | plan → execute          | codex · 6 Sol · medium     | 0.39         | 0.09             | fall back; model fallback | 242 ms  | 1471         | $0.0000618 |
| review                     | ask  | review   | 1.79             | read-only   | —         | direct                  | claude · Opus 5.5 · medium | 0.42         | 0.35             | fall back; model fallback | 231 ms  | 1463         | $0.0000614 |

Findings:

- Intent, risk, and injection are sharp: intent confidence 0.94 to 1.0, risk matches the sample in every case, and the injected "ignore all previous instructions" file scored 0.99.
- Depth is the uncertain question. After the depth criteria were rewritten to name concrete signals (files touched, risk), the typo and question samples reached 0.98 and 0.82, but multi-file, feature, and review work stays between 0.39 and 0.44, so balanced would fall back to the rules there. With the first, vaguer wording, every sample except chit-chat fell back.
- The provider choice is close to a coin flip (0.07 to 0.48 except chit-chat), so model routing would almost always fall back to the chat's provider. Within one provider the model pick is sensible: Haiku for trivial work, Sonnet or Opus for larger work, Luna or Sol on Codex.
- Latency was 150 to 360 ms, well inside the provider's cold start. Each call was about 1,500 input tokens, about $0.00006.

## Turn categories and auto titles (built September 26, 2026)

- **Categories.** The `intent` question now offers user-facing categories: Question, Debugging, Bug fix, Feature, Refactor, Review, Research, Docs, Setup, Chat. The pick is stored on the top-level run (`runs.category`) only when its confidence is at least 0.5. A chat's category is its most recent non-chat turn, else Chat. Without Jev, or when Jev fails or is unsure, no category is shown: the fixed rules do not guess one.
- **UI.** A quiet chip on each turn header and the crew dispatch line, the category in the sidebar row tooltip, an `is:<category>` filter in sidebar search (ids, labels, and aliases such as `is:bugfix` or `is:config`), and cost and turn counts by category in Settings → Usage and the audit summary. Child runs count toward their turn's category.
- **Auto titles.** `conversations.title_source` is `message`, `auto`, or `user`. While it is not `user`, the main agent (the in-place agent, or the Architect) is asked to end its reply with `Title: …`; that line is held back from the stream and the saved message and stored as `runs.suggested_title`. When the top-level run succeeds, the same transaction retitles a `message` chat with the agent title, or with a fallback of category plus main file or topic ("Refactor · format.ts"). An `auto` title changes again only when a later turn's confident category differs from the one it was titled under. Renaming sets `user`; the ⋯ menu can stop or resume auto titles. The title and its origin are recorded in the run's advice.

## Orchestrator: acting on Jev (built September 26, 2026)

The orchestrator (see [HARNESS_PLAN.md](HARNESS_PLAN.md#orchestrator-status-september-26-2026)) turns the intake from a record into a decision, always through `gate()`:

- **Intake** waits at most 3 s (the S2 call no longer runs beside the cold start). `act` uses Jev's depth; `ask` shows the Clarify card with Jev's top depth options in a Do chat; `fallback` uses the rules by mode and risk.
- **Routing** reuses the intake's `model_<provider>` and `effort_<provider>` answers for the Scout and the first Builder, and asks one batched routing call (`model_<role>_<step>`, `effort_<role>_<step>`) for planned Builders and the Critic. Each pick is gated like the intake's model pick. Pinned chats record Jev's pick as "Auto would have used …".
- **Transitions** ask `status`, `quality` and `next` after each Builder and the Critic, offering only the next steps that are possible (no retry once 2 are used, no second review).
- **Records.** Every decision is a `run_advice` row (`purpose` intake, route or transition) with the gate, what applied (Jev, rules, asked, pinned), the child run, role and step, latency and cost. A route that reused an earlier answer is `not_asked`. Jev's cost counts every call.
- **Authority.** Jev chooses depth, models and the next step. It never loosens the mode (a direct answer in a Do chat runs read-only), never answers an approval, never extends a budget, and its review is labelled an AI review.

## Next phases

1. **Review (M6).** Offer review using Jev's `review` and `reviewer` answers when confidence is at least about 0.6. Otherwise use the rules. Advice never grants permission.
2. **Route (opt-in).** Built as the chat's Auto option with the orchestrator; compare its outcomes with the rules before making it the default.
3. **Later.** Retry 429 and 529 with backoff, and allow pinning `jev-1.13.0`.

## Docs review 2026-09-27

On September 27, 2026 we re-read the TypeSafe documentation in full: every page in https://docs.typesafe.ai/llms.txt (111 pages, the `.md` form of each), including all 18 cookbooks, the Jev 1.13 jaggedness page and both SDK references. We also read the live OpenAPI spec (https://api.typesafe.ai/openapi.json, version 0.2.0) and the agent skill (https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md). We then compared our code against the guidance. Where to use Jev next is in [JEV_OPPORTUNITIES.md](JEV_OPPORTUNITIES.md).

### What has not changed since September 25

- **Models.** There is no new model. `jev-latest` and `jev-preview` both still point to `jev-1.13.0`, and no preview build exists (https://docs.typesafe.ai/models). Several cookbooks were run on `jev-1.12`.
- **Price.** Still $0.042 per million input tokens, and output is still free. There is no separate pricing page (`/pricing` returns 404), and no volume tiers or batch discount are listed.
- **Question types.** Still only Choice, Score and Noul. There is no multi-label, ranking, extraction, embedding or generation primitive.
- **Endpoints.** The OpenAPI spec lists only `POST /v1/systemone` and `GET /v1/models`. There is no batch, streaming, async, embeddings, caching or files endpoint.
- **Request fields.** A request has only `state`, `model` and `questions`. There is no temperature (the self-consistency cookbooks say Jev runs "without a temperature setting"), no few-shot `examples` field, no weights, no calibration hints and no rationale or explanation output.
  - The Python SDK's `extra_body={"beam_width": 4}` and a question `weight` are labelled as illustrative forward-compatibility examples, not real options (https://docs.typesafe.ai/sdk/python/usage#forward-compatibility).
  - Examples and weights belong in the question itself (see below) and in our code.
- **No docs changelog.** There are no `/changelog`, `/limits`, `/batching`, `/caching`, `/errors` or `/calibration` pages (all return 404). The only changelogs are the SDK ones:
  - JS SDK 0.6.0 (September 15): Score criteria became an ordered list.
  - Python SDK 0.7.0 to 0.7.2 (September 18 to 26): pydantic, `response_model`, an `http2` extra, and gateway examples.

### New, or missed on September 25

| Topic                       | What the docs say                                                                                                                                                                                                                                                                                                                                                                                      | Source                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rate limits                 | 250,000 tokens per second and 1,200 requests per minute per account. These are "adjusting dynamically" and can change without notice. Going over either returns 429.                                                                                                                                                                                                                                   | https://docs.typesafe.ai/models                                                                                                                                           |
| Concurrency in practice     | Cookbooks say a shared key starts rate limiting at "roughly eight" concurrent requests, and run 4 to 8 workers.                                                                                                                                                                                                                                                                                        | https://docs.typesafe.ai/cookbooks/entity_alignment, https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery                                                    |
| Context budget              | 64k tokens for the state plus all questions. A second limit is new: 32k tokens for the state plus the single longest question. Accuracy falls as the state grows with irrelevant detail.                                                                                                                                                                                                               | https://docs.typesafe.ai/models, https://docs.typesafe.ai/model-jaggedness/jev-1.13                                                                                       |
| Limits per question         | Up to 255 Choice options (one cookbook says it is reliable up to about 240). A Score takes 2 to 10 levels; an 11th level returns a server error. No maximum on questions per call: the docs show 38, 54 and 62 in one request.                                                                                                                                                                         | https://docs.typesafe.ai/api, https://docs.typesafe.ai/cookbooks/classification_using_confidence, https://docs.typesafe.ai/cookbooks/autoformat                           |
| How confidence is computed  | For Choice and Score, `confidence = (n·p_max − 1) / (n − 1)`, where `n` is the number of options or levels. This is the formula in the Confidence page's explorer, and it matches every example response. So the same top probability gives a different confidence depending on how many options were offered. Noul has no confidence.                                                                 | https://docs.typesafe.ai/confidence                                                                                                                                       |
| Latency                     | "Most queries complete in about 100 ms". The launch post says 70 to 500 ms end to end. Cookbooks measured 0.09 to 0.51 s, including 0.27 s for 13 questions on a 54k-character state. We measured 150 to 360 ms.                                                                                                                                                                                       | https://docs.typesafe.ai/concepts/how-to-build-with-system-one, https://typesafe.ai/blog/introducing-system-one-models-and-jev                                            |
| Batching                    | Put every question on the same state in one call. The parallel-questions cookbook measured 13 questions in one call as 12.2× cheaper and 10× faster than 13 calls, with identical answers. The primitives page quotes this as 11.5× and 9.6×. Speculative questions whose answer only matters on some branches are "close to free".                                                                    | https://docs.typesafe.ai/cookbooks/parallel_questions, https://docs.typesafe.ai/patterns/fan-out                                                                          |
| Structured questions        | `instructions`, Choice option descriptions, Score levels and Noul `true`/`false` criteria can all be objects or arrays, not only strings. This is how you give examples and boundaries: fields such as `what`, `not_for` and `examples` on each option or level. The field names are free text, and the model reads them.                                                                              | https://docs.typesafe.ai/primitives/advanced, https://docs.typesafe.ai/primitives/choice#structured-instructions-and-criteria                                             |
| Multi-select and ranking    | For several labels that may all apply, ask one Noul per label or candidate, with the candidate as a structured field in `instructions` and a fixed question text. Rank by sorting the noul values. A Choice is relative (which one); per-candidate Nouls are absolute and can all come back low. Use both: the Choice picks, the Nouls decide whether to act at all.                                   | https://docs.typesafe.ai/primitives/noul#structured-instructions, https://docs.typesafe.ai/cookbooks/rerank_typesafe, https://docs.typesafe.ai/cookbooks/skill_suggestion |
| Verifying a trace           | The building guide verifies an agent's tool-call trace with one Noul per fact ("Does `trace.tool_calls[1].arguments.unit` match `request.unit`?"), not one broad "is this correct?". The extraction cascade frames each check as "bad = true" and escalates when the **max** over the checks passes 0.7. In that cascade a holistic judge scored 0.56 where the per-field checks scored 0.95 and 0.85. | https://docs.typesafe.ai/concepts/how-to-build-with-system-one, https://docs.typesafe.ai/cookbooks/sde_cascade                                                            |
| Known weak spots (jev-1.13) | Nine failure modes, last reviewed September 17: <br>• literal reading <br>• numbers and counting ("keep the arithmetic in code") <br>• dates <br>• indirection <br>• large irrelevant state <br>• adversarial content moves answers <br>• contradictory instructions and criteria <br>• no structural invariants between separately asked questions <br>• generation                                   | https://docs.typesafe.ai/model-jaggedness/jev-1.13                                                                                                                        |
| Self-consistency            | Repeated calls are not bit-identical. The mean std-dev of a probability is about 0.01. The docs say to use abstention bands rather than repeated voting.                                                                                                                                                                                                                                               | https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook, https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook                                              |
| Pin versions                | An alias moves when a release ships, so answers can change with no change on our side. Log the response's `model` field. If thresholds were tuned against a version, pin that version (`jev-1.13.0`, accepted even though `/v1/models` lists only aliases).                                                                                                                                            | https://docs.typesafe.ai/models#aliases                                                                                                                                   |
| Errors and retries          | The SDKs retry 408, 429 and 5xx (including 529) twice by default:<br>• backoff starts at 500 ms and doubles up to 5 s, with 25% jitter<br>• they honour `retry-after` and `retry-after-ms` up to 60 s<br>• the timeout is per attempt (10 s default) with no total budget<br>Errors carry an `x-typesafe-request-id` header.                                                                           | https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy, https://docs.typesafe.ai/sdk/javascript/api/classes/APIError                                          |
| Other routes                | Jev is also reachable through OpenRouter (`~typesafe/jev-latest`) and Vercel AI Gateway (`https://ai-gateway.vercel.sh/typesafe`). Either one adds a third party to the data path.                                                                                                                                                                                                                     | https://docs.typesafe.ai/sdk/python/usage#configuring-the-base-url                                                                                                        |
| Data                        | Jev is not trained on requests. There is no per-account fine-tuning: you customise through `state`, `instructions` and `criteria`. Zero data retention is still enterprise-only. The Data Processing Agreement covers retention.                                                                                                                                                                       | https://docs.typesafe.ai/models#customizing-jev, https://docs.typesafe.ai/legal                                                                                           |
| Language                    | English is the primary training language. Other languages are accepted but are less accurate.                                                                                                                                                                                                                                                                                                          | https://docs.typesafe.ai/models#language-support                                                                                                                          |
| Harness use                 | The use-case map names "Harness Engineering": model routing, semantic context retrieval, LLM error detection and guardrails, and classifying reasoning traces. It also names "Universal Verification" of tool calls and traces.                                                                                                                                                                        | https://docs.typesafe.ai/concepts/use-case-map                                                                                                                            |
| Docs defects                | The agent skill links a "Migration guide" at `/migrating-to-v1.md`, which returns 404. The autoformat cookbook gives its cost as both $0.0003 and $0.0015.                                                                                                                                                                                                                                             | SKILL.md, https://docs.typesafe.ai/cookbooks/autoformat                                                                                                                   |

### Where our code goes against the docs

Ordered by impact. Nothing here is fixed yet; this review changed docs only.

1. **Our Noul criteria use the wrong keys.** The API's Noul `criteria` takes `true` and `false` (https://docs.typesafe.ai/api#noul, OpenAPI `NoulCriteria`). Every Noul we send uses `yes` and `no` instead:
   - `review_existing`, `mechanical`, `vague` and `injection` in `advisor/intake-questions.ts`
   - `independent_N` and `large_N` in `orchestration/parallel-choice.ts`
   - `one_builder` and `same_folder` in `orchestration/lane-choice.ts`

   The schema does not forbid extra keys, so the request passes validation and the descriptions are almost certainly ignored. Every Noul we have measured was therefore judged on its `instructions` alone. The fix is to rename the keys and re-run the live intake test to see how the answers move.

2. **The resolved model version is not recorded.** We send `jev-latest`, and `callJev` records the alias we asked for (`access.model`), not the response's `model`. When the alias moves to a new version, every gate we tuned on `jev-1.13.0` silently shifts, and the analytics cannot tell the versions apart. The docs say to log `model` and to pin a version once thresholds are tuned. Store `response.model` on every `run_advice` row, and pin `jev-1.13.0` (the "Later" item under Next phases) until a new version has been measured.
3. **Our confidence gates ignore how many options were offered.** Confidence is `(n·p − 1)/(n − 1)`, so one gate line means a different top probability for each option count:

   | Options offered                  | Top probability needed for 0.5 | for 0.75 | for 0.9 |
   | -------------------------------- | -----------------------------: | -------: | ------: |
   | 2 (e.g. `provider`, some `next`) |                           0.75 |    0.875 |    0.95 |
   | 3                                |                           0.67 |     0.83 |    0.93 |
   | 4 (`depth`, `scope`, `status`)   |                           0.63 |     0.81 |    0.93 |
   | 10 (`intent`)                    |                           0.55 |     0.78 |    0.91 |

   Consequences:
   - The "provider choice is a coin flip" reading was partly this formula at n = 2.
   - The intake confidence (`intent` over 10 options against `depth` over 4) mixes scales.
   - `next`, `build_style` and the route questions offer 2 to 4 options depending on the state, so the same gate is stricter or looser from call to call.

   Gate on the top probability or on the margin to the runner-up (both are in `probabilities`), or keep option counts fixed per question. The agent skill adds: "If all you care about is choosing the best option, you just need to choose the option with the highest confidence".

4. **Some questions are broad where the docs ask for atomic ones.**
   - The transition asks "What should happen next?" and rates `quality` "judged from `reply`, `verdict` and the counts" (`jev-questions.ts`). Both hide several judgments in one answer. The docs call "Analyze … and determine the best course of action" a bad question, and the jaggedness page lists "hiding several judgments inside one question".
   - The live run missed a half-done plan in exactly this spot: "done · next finish" at 0.60 (benchmarks/harness-e2e-live-2026-09-26.md, d #1).
   - Replacement: one Noul per fact, with code choosing the next step. See opportunity 1.
5. **Score levels describe degrees, not situations.** The docs say "Describe situations, not degrees", and each level is judged on its own without seeing its neighbours (https://docs.typesafe.ai/primitives/score#writing-good-levels).
   - `QUALITY_CRITERIA` ("Poor: major gaps", "Fair: works with notable issues") and the effort Scores (the adapter's effort labels, "low", "medium", "high") are degree words.
   - `risk` is ordered well, but it mixes two dimensions, how much changes and how destructive it is.
   - `depth` is an ordered scale asked as a Choice.
6. **Numbers are sent for Jev to reason about.** The jaggedness page says Jev is weak with numbers and counting, and to "keep the arithmetic in code" and pass named buckets.
   - The transition state sends `stepsLeft`, `retriesLeft`, `findings`, `filesChanged` and `toolCalls`.
   - `LARGE_QUESTION` asks about "≥20s of work".
   - Model card lines carry prices and pass counts ("bench plan 10/10 ~$0.17").
   - Code already enforces the limits through the offered options. Pass buckets ("no retries left", "checks failed") instead of raw counts, and keep price and pass-rate comparisons in code.
7. **One question is framed in the negative.** The docs say a high value should mean yes, and warn against contradictory framing.
   - `one_builder` asks whether one Builder "would be as good as parallel Builders", so a high value means "don't split". That is workable, but it is the negated form of the decision we act on, and the jaggedness page shows a question and its negation do not sum to 1.
   - `vague` and `injection` are fine: yes means the thing we check for.
8. **The docs on privacy are out of date.** The "Never sent: … file names and paths" line above is no longer true.
   - Since harness round 3, the parallel batch sends each plan step's text unredacted (300 characters) plus its `changes` and `reads` file lists (`buildParallelQuestions`, `stepFiles`).
   - Since round 7, the lane questions send each chain's changed files and its sensitive file names.
   - The transition `reply` tail can still quote code.

   Either redact the paths there too, or change the data-sent list, update the pinned tests and tell the user. See [JEV_OPPORTUNITIES.md](JEV_OPPORTUNITIES.md#risks) for how new uses would widen this.

   **Decided September 27, 2026:** keep the paths, and stop redacting them elsewhere too (routing, transitions, step checks). The data-sent table above lists every field, the pinned tests were updated, and Jev's connection details in the app say what is sent.

9. **The intake state carries an unused field.** Every intake sends `providers` (model ids per provider), but no question refers to it: the model options already carry the same ids. The docs say to send only the context the questions need.
10. **We could batch more.**
    - `build_style` is its own call on the same state (`task`) right after the intake, so it could join the intake batch as a speculative question.
    - The Architect route could be asked speculatively in the intake too, with the provider's models as options.
    - This would save one to two round trips (150 to 350 ms each) per planned turn. The docs say a second request is justified only when it needs an earlier answer to build its state or options.
11. **We do not retry.** `askSystemOne` fails on the first 429 or 529, where the SDKs would retry twice with backoff. With the 3 s orchestration timeout there is room for one retry: when at least 1 s is left, honour `retry-after-ms`. Then fall back to the rules as today.
12. **The injection noul is not a security boundary.** The docs say adversarial content can move Jev's answers, and the guardrails cookbook calls such a check "a filter, not a security boundary". We only record the injection answer, which is right. Keep it that way, and never use it to relax a check.

### How confidence should be read

The docs are consistent on these points:

- Calibration holds across groups of answers, not for any one answer.
- Low confidence means the options overlap, the question measures more than one thing, or the state lacks the evidence. It is a reason to ask or fall back, not a verdict.
- Thresholds scale with the cost of a wrong action. The confidence-routing pattern uses a 0.6 floor, and 0.85 for a high-stakes action.
- A Noul threshold is chosen per action: 0.5 when both errors cost the same, higher when a false yes is expensive, and lower when a missed yes is. Middle values go to review. The Noul page's example uses 0.2 and 0.8.
- For a result built from several answers, use the weakest one (`min`), not the product. For "any serious problem" checks, use the `max` of the bad-is-true Nouls.
- Validate thresholds by plotting confidence against accuracy on our own data. The Harness tab already draws Jev's confidence against the outcome score with the gate lines; it is the place to do this.

Our `gate()` follows this shape: act, ask, or fall back, with stricter lines for riskier work. The gaps are points 3 and 4 above.

## Fixes 2026-09-27

These fix points 1, 2, 3, 5, 6, 10 and 11 of the docs review above, and add opportunity 1 of [JEV_OPPORTUNITIES.md](JEV_OPPORTUNITIES.md#1-did-the-builder-do-its-steps). Point 8 (file paths in the parallel and lane questions) was decided by the user on September 27: keep sending them, and send paths wherever they help; see [Data sent](#data-sent).

### Noul criteria keys (point 1)

- Every Noul is built by `noulQuestion(instructions, { true, false })` in `apps/server/src/advisor/questions.ts`. Its type only accepts `true` and `false`, as in the API's `NoulCriteria` (OpenAPI 0.2.0). The intake (`review_existing`, `mechanical`, `vague`, `injection`), parallel (`independent_N`, `large_N`), lane (`one_builder`, `same_folder`) and new step-check Nouls all use it.
- `apps/server/src/orchestration/noul-requests.test.ts` sends all of them through `askSystemOne` and asserts that every Noul's criteria keys are exactly `true` and `false`, and the exact JSON of `injection`.
- **Live check** (one call, `jev-1.13.0`, 406 input tokens, about $0.00002, 485 ms). The state was `{ text: "Water boils at 100 °C at sea level." }`. Two Nouls had the same instructions ("Is `text` correct?") and descriptions that flip the meaning (true: "The text contains a factual error", false: "The text is factually correct"):

  | Criteria keys          | Noul |
  | ---------------------- | ---: |
  | `yes` / `no` (before)  | 0.95 |
  | `true` / `false` (now) | 0.75 |

  With `yes`/`no` Jev answered the instructions alone (the sentence is correct, so 0.95). With `true`/`false` the same descriptions pulled the answer 0.20 toward the flipped meaning, so the descriptions are now read. It did not flip fully because the instructions and the criteria contradict each other on purpose here. Every Noul measured before today, including the injection results above, was judged on its instructions alone.

### Model version (point 2)

- Requests for `jev-latest` are sent as `jev-1.13.0` (`requestModel` in `advisor/jev.ts`), the version the gates were tuned on, as the models page recommends once thresholds are tuned. `jev-preview` or another explicit name is sent unchanged. The stored connection still says `jev-latest`.
- Every advice record stores the version that answered (`response.model`): the intake body's `jevModel`, and `jevModel` in the body of every route, transition, parallel and build-style row. A failed call records the version it asked for.
- `noteJevVersion` logs one warning per process for each answering version other than `jev-1.13.0`. Analytics do not show the version yet: that needs a contract and a UI change, so the version is only in the row bodies for now.

### Confidence (point 3)

- For Choice and Score we use the confidence Jev reports, which is `(n·p_max − 1)/(n − 1)` (confirmed again in the live call: a 3-option Choice at p = 1.0 reported 1.0). That formula already puts every option count on one scale: 0 means no better than an even guess among the options offered, 1 means certain. So a gate line means "this far from chance" whatever the option count, and we keep gating on it. The review's table shows what top probability each line needs per option count.
- The one place we computed our own confidence did not follow it: the parallel and lane Nouls used `max(p, 1 − p)`. `noulConfidence` now applies the same formula with n = 2 (`optionConfidence` in `advisor/gate.ts`), and `NOUL_CERTAINTY` moved from 0.75 to 0.5 on that scale. Decisions are unchanged: a Noul is still trusted at 0.75 or more, or 0.25 or less.

### Rate limits and retries (point 11)

- `JevLimiter` (`advisor/jev-limiter.ts`) keeps at most 4 Jev calls in flight per process. Time spent waiting for a slot counts against the call's timeout.
- A 429 or 529 is retried once. The wait is `retry-after-ms`, else `retry-after`, else 500 ms with 25% jitter, and the retry only happens when at least 1 s of the budget (3 s in orchestration, 10 s for the recorded intake) would be left. Otherwise, or when the retry also fails, the call fails as before and the rules decide.

### Batching (point 10)

`build_style` is no longer its own call. When a Do turn runs in a project with a build style, the intake batch asks it speculatively (`advisor/build-style-question.ts`), and `decideBuildStyle` reads that answer. Its `run_advice` row is `not_asked` with no tokens, like a route that reuses the intake's answer. Planned turns save one round trip.

### Question phrasing (point 6)

- Score levels describe situations: `quality` levels are `{ what, examples }` objects ("Only part of it was done: pieces the step asked for are missing or broken"), the effort Scores are `{ effort, when, note }` with a situation per level (for example "Routine work with an obvious approach"), and `complexity` levels no longer start with degree words. The meaning and order of every level are unchanged.
- The transition state sends buckets instead of numbers: `stepsLeft` ("this was the last step", "one more step", "several more steps"), `retriesLeft` ("none left", "one left", "several left"), `findings` ("none", "a few", "many"), `filesChanged` ("none", "one file", "a few files", "many files") and `toolCalls` ("none", "a few", "many", "a great many"). The keys are the same; code still uses the numbers to decide which `next` options to offer.

### Did the Builder do its steps? (opportunity 1)

- After a Builder succeeds, the existing transition call also asks, for each step the markers would mark done: `step_not_done_N` ("Is there no sign in `reply` that `plan_step` was done?"), `step_left_N` (unfinished, skipped, failed or left for later) and `criterion_unmet_N_i` for up to three "Done when" items. The items come from the step's work order `acceptance` list; without a work order the step text is the contract. Every check is bad = true, and the step text and criteria sit in structured `instructions`, with file paths kept since September 27 (they were replaced by `[path]` before). No new `state` fields are sent.
- For each step the worst (highest) answer decides: 0.8 or more is open, 0.2 or less is done, anything between leaves the markers in charge. Jev can only reopen a step, never close one.
- An open step continues the same Builder with the round-5 `continue` follow-up, the other steps of its span stay done, and the plan artifact shows the reopened steps in progress. Each such continuation uses one repair retry, so it cannot loop; with no retries left the markers decide as before.
- The transition row records every step's worst answer and verdict (`answer.steps`, `answer.open`), and the summary adds "Jev: step 2 (0.86) not done".
- This acts without a shadow period, which rule 7 of the opportunities file would ask for. Watch the transition rows for reopened steps that were in fact done.

## Watchdog (round 9, September 27, 2026)

Jev is cheap (about $0.00004 per check), so it now watches every crew member while it runs, not only between steps. This is [JEV_OPPORTUNITIES.md](JEV_OPPORTUNITIES.md#5-stuck-or-looping-agent) opportunity 5, built with the user's decisions. Code is in `apps/server/src/orchestration/watchdog*.ts`.

- **When.** Per active member (Scout, Architect, Builder, Critic; the in-place member too): every 10 tool calls, or after 2 minutes without any output. A silence check is skipped while the member waits on a permission approval, since that is you, not the agent.
- **Code first.** From the last 12 tool-call titles, code computes the identical tail, the most frequent call and an A-B-A-B back-and-forth, and passes them as named buckets (`flags`). The rule alone calls a member stuck only after 5 identical non-edit calls in a row; an edit/test fix loop never counts.
- **One batched call**, four Nouls framed so the bad outcome is true: `repeating` (the same actions without progress on `work`), `off_step` (working on something other than `work`), `waiting` (waiting on something it cannot get: a missing tool, permission, install, service or input) and `finished` (looks finished but keeps going). See [Data sent](#data-sent) for the state.
- **Verdict.** The worst Noul decides: 0.85 or more is stuck, 0.3 or less is fine, and in between (or with Jev unavailable or over budget) the rule decides.
- **Action by level.** Hands-on and Balanced raise a checkpoint, "Bolt looks stuck: repeating Read src/dates.ts. Nudge Bolt / Let it continue / Stop", whose auto-continue (the usual setting, 10 s by default) picks Let it continue. Only one watchdog checkpoint is open per orchestration, and it closes by itself ("It moved on before you answered") when the member ends. The member keeps working while it waits, and that time does not count as waiting for the budget. Hands-off and Full auto send a nudge instead. Nothing is ever stopped automatically; Stop on the checkpoint is your choice.
- **Nudges.** ACP has no way to add a message to a turn in flight, and the harness has no interrupt short of cancelling, so a nudge is queued for the member's next turn (its continue, fix or check-fix follow-up, which resumes the same session): the follow-up and the stored prompt gain "## Note from the harness" with fixed text chosen by code per reason, and the child run's `route.nudge` records it. A member that loops until its budget ends never gets it; the budget stop still applies as before.
- **Limits.** At most 20 watchdog calls per orchestration (then the rule alone decides), the process-wide limiter (4 Jev calls in flight), never more than one watchdog call in flight per member, and after acting the next action for that member waits two checks.
- **Records.** Every check that asked Jev, or that the rule flagged, is a `run_advice` row with `purpose = 'watchdog'`: the summary ("Bolt looks stuck: repeating Read src/dates.ts · asked you (Jev 0.95; rule: stuck, 10 identical calls in a row)"), who decided (`applied`), Jev's four answers, the rule's verdict, the flags, the trigger and the action. A stuck flag shows on the member in the crew turn and Agent TV ("looks stuck: …"), a line under its work log ("Jev: looks stuck, … · nudge queued for its next turn"), and a pending watchdog checkpoint is a "Looks stuck" attention state in the sidebar, Home and the companion.
- **Unchanged.** The per-step "did the Builder finish" check still acts (see above), and the budgets still catch what the watchdog misses.
- **Tests.** Unit: `watchdog-rules.test.ts` (repeat heuristics, when to check, the verdict, the action per level and cooldown, nudge text, the summary), `watchdog-questions.test.ts` (state and question keys, paths kept, secrets redacted, parsing), `watchdog.test.ts` (one call in flight per member, the call budget, nudges at Full auto, a healthy check, off). DB with the fake agent (`orchestration-watchdog.db.test.ts`): a looping Builder raises the checkpoint at Balanced and the auto-continue lets it continue; at Full auto it is nudged, never stopped, and the nudge reaches its next turn; a healthy busy Builder is recorded as fine and nothing happens.

## Frontier gate at 0.90 (September 27, 2026)

At the user's request a Jev pick of a frontier model (Fable 5.1, 6 Astra), offered only when that provider's "Allow frontier models" switch is on, now acts at 0.90, the same line as the normal upgrade gate (`ACT_AT_FRONTIER = ACT_AT` in `advisor/gate.ts`), instead of 0.95. See [MODEL_CARDS.md](MODEL_CARDS.md#allow-frontier-models-per-provider-decided-september-26-2026).
