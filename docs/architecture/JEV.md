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
- **(b) Router: yes.** Routing is a documented pattern (https://docs.typesafe.ai/patterns/intent-routing, https://docs.typesafe.ai/patterns/confidence-routing). This matches HARNESS_PLAN decision 3: Jev chooses the provider, model, and effort, and whether to review.

## API

- **Auth:** `Authorization: Bearer <key>`, with keys from https://console.typesafe.ai/keys. The key format isn't documented, so the app checks nothing locally.
- **Base URL:** `https://api.typesafe.ai`, configurable as `TYPESAFE_BASE_URL` (the SDK's own variable, https://docs.typesafe.ai/sdk/javascript/api/variables/ENV).
- **`GET /v1/models`:** returns `{ models: [{ name, description, release_date }] }` and spends no tokens. The connection check uses it (https://docs.typesafe.ai/models#listing-models).
- **`POST /v1/systemone`:** takes `{ state, model, questions }` and returns `{ model, answers, usage }` (https://docs.typesafe.ai/api).
- **Errors:** 401, 422, 429, and 529.
- **Models:** `jev-latest` and `jev-preview`. Input is text only, up to 64k tokens.

## Cost

The price is $0.042 per million input tokens. Output tokens are free (https://docs.typesafe.ai/models). Responses report tokens, not cost. One routing call is a few hundred to a few thousand tokens, well under $0.0001. Verifying a key spends nothing. Jev gets no "Send test message", because a test would be billed.

## Data sent

- **Sent to TypeSafe (S2 intake):**
  - the new message only, capped at 8,000 characters
  - the mode and whether any repo is linked
  - the connected provider IDs with their model IDs, labels and descriptions, and effort levels. Since the model cards ([MODEL_CARDS.md](MODEL_CARDS.md)), a carded model's description is its card line (tier, speed, price, a vendor blurb and at most one aggregate benchmark stat, 160 characters at most), a provider is described by its card, and frontier models are left out unless allowed for that provider
  - the text of files attached to the new message, capped at 8,000 characters in total, only so Jev can judge whether that untrusted text tries to steer the agent (no file names)
  - later, for review decisions, a summary of the changes (counts, and whether a check ran)
- **Sent to TypeSafe (orchestrator routing):** the new message again, and for each subagent its role and, for a Builder, its plan step (300 characters) with path-like words replaced by `[path]`.
- **Sent to TypeSafe (orchestrator transitions):** the new message, the role, the step (as above), whether the agent succeeded, the last 1,000 characters of its reply with path-like words replaced by `[path]`, steps and retries left, the Critic's verdict, and counts of findings, changed files and tool calls. The reply tail is the only agent output sent; it can still quote code.
- **Never sent:** repo contents, history, file names and paths, diffs, tool output, and credentials.
- `apps/server/src/advisor/intake-questions.test.ts` and `apps/server/src/orchestration/jev-questions.test.ts` pin the exact `state` keys and question keys, so any new field is a visible change.

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
