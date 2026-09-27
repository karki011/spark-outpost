# Model cards

Designed on September 26, 2026 (Phase 1: research, data and design) and built the same day (Phase 2, see [Built](#built-september-26-2026)). See [JEV.md](JEV.md) for Jev's questions and [HARNESS_PLAN.md](HARNESS_PLAN.md) for the routing rules that use tiers.

## Why

Jev picks the provider, model and effort for every agent. Today it sees only:

- the provider name
- each model's id, label and the adapter's one-line description (for example "Sonnet 5 · Efficient for routine tasks")
- the effort names

Tiers come from a regex in `orchestration/tiers.ts` (`haiku|luna` is 0, `sonnet|sol` is 1, `opus|astra` is 2). So Jev knows nothing about price, speed, limits or how each model did on our own benchmark. The regex also gets some models wrong:

- **Fable 5.1 (`claude-fable-5-1[1m]`) has no tier.** It is left out of the ladder, and `notPricier` treats it as unknown.
- **`gpt-5.6-sol` gets the middle tier**, but it is the 5.6 family's flagship ($4/$20, above 6 Sol's $2/$10).
- **Nothing knows that Haiku 4.5 does not support the API effort parameter**, yet routes read "Haiku 4.5 · low".

A model card holds the vendor facts plus what we measured ourselves. Jev gets a short version of each card, and tiers come from the cards.

## Data gathered (Phase 1)

Files:

- `apps/server/src/model-cards/vendor-cards.json`: vendor facts for 11 models and the 2 provider cards
- `apps/server/src/model-cards/measured-seed.json`: 30 measured rows from the three benchmark rounds that have JSON

### Vendor facts (checked September 26, 2026)

Prices are USD per million tokens (input / cached input / output). "Ids we see" are the values the ACP adapters offer (from `provider_capabilities`, captured September 26).

| Model         | Ids we see                    | Tier     | Price              | Context / max output | Speed (vendor)             | Reasoning                                       | Knowledge |
| ------------- | ----------------------------- | -------- | ------------------ | -------------------- | -------------------------- | ----------------------------------------------- | --------- |
| Haiku 4.5     | `haiku`                       | small    | 1 / 0.10 / 5       | 200K / 64K           | fastest                    | extended thinking; **API effort not supported** | Feb 2025  |
| Sonnet 5      | `sonnet`                      | mid      | 2 / 0.20 / 10      | 1M / 128K            | fast                       | adaptive; low to max, default high              | Jan 2026  |
| Opus 5.5      | `opus[1m]`                    | top      | 4 / 0.20 / 20      | 1M / 128K            | moderate                   | always thinks; low to max, default **medium**   | Jun 2026  |
| Fable 5.1     | `claude-fable-5-1[1m]`        | frontier | 10 / 0.25 / 50     | 1M / 128K            | slower                     | always thinks; low to max, default high         | Jun 2026  |
| 6 Luna        | `gpt-6-luna`                  | small    | 0.10 / 0.01 / 0.50 | 1.05M / 128K         | fast (reasoning "High")    | none to max, default medium                     | May 2026  |
| 6 Sol         | `gpt-6-sol`                   | mid      | 2 / 0.20 / 10      | 1.05M / 128K         | fast (reasoning "Highest") | none to max, default medium                     | Apr 2026  |
| 6 Astra       | `gpt-6-astra` (Codex default) | frontier | 10 / 1 / 50        | 1.05M / 128K         | fast (reasoning "Highest") | low to max, no default stated                   | Apr 2026  |
| GPT-5.6 Luna  | not offered                   | small    | 0.20 / 0.02 / 1.20 | 1.05M / 128K         | fast                       | none to max                                     | Feb 2026  |
| GPT-5.6 Terra | not offered                   | mid      | 2 / 0.20 / 12      | 1.05M / 128K         | fast                       | none to max                                     | Feb 2026  |
| GPT-5.6 Sol   | not offered                   | top      | 4 / 0.40 / 20      | 1.05M / 128K         | fast                       | none to max                                     | Feb 2026  |
| GPT-5.5       | not offered                   | top      | 5 / 0.50 / 30      | 1.05M / 128K         | fast                       | none to xhigh                                   | Dec 2025  |

Notes:

- **Claude caching.** Cache reads are 0.1x the input price, but 0.05x on Opus 5.5 and 0.025x on Fable 5.1. Claude has no long-context surcharge.
- **OpenAI long context.** Over 272K input tokens, OpenAI charges 2x input and 1.5x output for the whole request.
- **Speed labels.** OpenAI rates every one of these models "Fast", so its speed label doesn't separate them. The OpenAI speed class is therefore the vendor label, and the tier carries the real difference.
- **Retirements.** Haiku 4.5 retires no sooner than October 15, 2026. GPT-5.5 retires from ChatGPT sign-ins (and so from Codex) on October 14, 2026.

Sources, each checked September 26, 2026 (also stored per card):

- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- https://platform.claude.com/docs/en/build-with-claude/effort
- the "what's new" pages for Opus 5.5, Sonnet 5 and Fable 5.1, and the Haiku 4.5 overview
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/models/ (gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5)
- https://learn.chatgpt.com/docs/models (the Codex models page; developers.openai.com/codex/models redirects there)

Strengths and weak spots per model are in the JSON. They are short phrases from those pages, not our opinion.

### Provider cards (from ACP_AGENTS.md)

|                      | Claude (claude-agent-acp 0.81.2)                                                                                        | Codex (codex-acp 1.13.1, patched)                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Do mode              | yes                                                                                                                     | **no**: agent mode ran `ls` and wrote a file without asking                                               |
| Asks before commands | every edit and command, read-only ones included                                                                         | only for actions outside its sandbox                                                                      |
| Sandbox              | none at OS level; tools limited, secret files denied, Bash unsandboxed after approval, its tools bypass our path policy | true read-only sandbox, but it can read the whole disk; the chat file editor can still write under `/tmp` |
| Resume               | yes, across processes                                                                                                   | yes (`thread/resume`)                                                                                     |
| Review use           | yes                                                                                                                     | yes: the default Critic for a Claude chat; slow on R1 (over a minute)                                     |
| Cold start           | 8–10 s                                                                                                                  | 4–9 s                                                                                                     |
| Cost                 | reported                                                                                                                | estimated from tokens                                                                                     |

### Measured (benchmark rounds baseline, tuned and round 3, all September 26, 2026)

Fixture: Ledger Lite, Full auto. Pass is the whole run's hidden-test verification.

- **Shared credit.** "Shared" counts rows from multi-agent runs, where the pass belongs to the crew.
- **Cost and time.** Cost and wall time are the agent's own.
- **Roles.** Direct is one Sonnet agent with no harness. Architect rows are the plan category, and Critic rows are review.

| Model · effort    | Role      | Category    | n     | Pass  | Mean cost     | Mean wall | Shared | Rounds          |
| ----------------- | --------- | ----------- | ----- | ----- | ------------- | --------- | ------ | --------------- |
| Haiku 4.5 · low   | builder   | fix         | 6     | 6/6   | $0.023        | 10.5 s    | 0      | all three       |
| Haiku 4.5 · low   | builder   | feature     | **1** | 1/1   | $0.039        | 28.1 s    | 1      | baseline        |
| Sonnet 5 · medium | direct    | fix         | 15    | 15/15 | $0.081        | 26.2 s    | 0      | all three       |
| Sonnet 5 · medium | builder   | fix         | 9     | 9/9   | $0.091        | 29.3 s    | 3      | all three       |
| Sonnet 5 · medium | direct    | feature     | 16    | 14/16 | $0.120        | 52.6 s    | 0      | all three       |
| Sonnet 5 · medium | builder   | feature     | 23    | 22/23 | $0.093        | 29.2 s    | 12     | all three       |
| Sonnet 5 · medium | direct    | refactor    | 7     | 7/7   | $0.108        | 36.5 s    | 0      | baseline, tuned |
| Sonnet 5 · medium | builder   | refactor    | 14    | 14/14 | $0.063        | 22.1 s    | 12     | baseline, tuned |
| Sonnet 5 · medium | direct    | review      | **1** | 1/1   | $0.148        | 72.9 s    | 0      | round 3         |
| Sonnet 5 · medium | builder   | review      | **1** | 1/1   | $0.127        | 55.6 s    | 0      | round 3         |
| Sonnet 5 · medium | direct    | destructive | **2** | 2/2   | $0.120        | 41.1 s    | 0      | round 3         |
| Sonnet 5 · medium | builder   | destructive | **2** | 2/2   | $0.112        | 35.9 s    | 1      | round 3         |
| Sonnet 5 · high   | architect | plan        | 4     | 4/4   | $0.124        | 40.1 s    | 4      | tuned, round 3  |
| Opus 5.5 · high   | architect | plan        | 10    | 10/10 | $0.171        | 36.6 s    | 10     | all three       |
| 6 Sol · high      | critic    | review      | **1** | 1/1   | $0.004 (est.) | 34.8 s    | 1      | round 3         |

What the data can and cannot say:

- **Small samples.** Rows marked in bold have n ≤ 2 and are anecdotal. Only Sonnet 5 at medium has real samples across categories.
- **Why pass rates barely differ.** Every failure is H3, the ledger migration: direct failed it 2 of 2 in the tuned round, and a Sonnet Builder once. So the pass rate separates tasks, not models. What the numbers do show is cost: Haiku fixes cost 27% of what a Sonnet fix costs and pass as often, and a Sonnet Architect costs 73% of an Opus one.
- **No data at all** for these, so their cards carry vendor facts only:
  - Fable 5.1
  - Opus as a Builder
  - Haiku on refactor, review or destructive work
  - 6 Luna and 6 Astra
  - Codex on anything but one review
  - the question category (no round has a question task)
- **Not ingested.** Round 4 and the lean A/B (in `harness-vs-direct-2026-09-26-round3.md` and `LEAN_BUILD.md`) only have Markdown summaries without per-agent rows. The runner writes JSON for every round from now on (below), so later rounds will be ingested.

## Design

### Schema (`packages/contracts/src/model-cards.ts`)

```ts
modelTierSchema = z.enum(['small', 'mid', 'top', 'frontier']);
cardCategorySchema = z.enum(['question', 'fix', 'feature', 'refactor', 'review', 'plan', 'destructive']);

modelCardSchema = z.object({
  provider: z.string(),                       // 'claude' | 'codex' | 'glm'
  id: z.string(),                             // vendor id, 'claude-sonnet-5'
  label: z.string(),                          // 'Sonnet 5'
  match: z.object({ ids: z.array(z.string()), labels: z.array(z.string()) }),
  tier: modelTierSchema,
  price: z.object({ inputPerMillion, cachedInputPerMillion, cacheWritePerMillion: nullable, outputPerMillion, note }).nullable(),
  contextTokens: z.number().int(), maxOutputTokens: z.number().int(),
  speed: z.enum(['fastest', 'fast', 'moderate', 'slower']),
  reasoning: z.object({ mode, efforts: z.array(z.string()), defaultEffort: nullable, note }),
  strengths: z.array(z.string()).max(4), weakSpots: z.array(z.string()).max(4),
  blurb: z.string().max(60),                  // hand-written, goes into Jev's text
  knowledgeCutoff: z.string(), retiresNotBefore: z.string().nullable(),
  sources: z.array(z.object({ url: z.string(), checkedAt: isoDate })).min(1),
});

providerCardSchema = z.object({
  provider, label, adapter,
  doMode: z.enum(['yes', 'no']), asksBeforeCommands: z.enum(['every', 'outside-sandbox-only', 'never']),
  sandbox, resume: z.enum(['yes', 'no']), review: z.enum(['yes', 'no']),
  coldStartSeconds: z.tuple([z.number(), z.number()]), costSource: z.enum(['reported', 'estimated']),
  everydayModel: z.string().nullable(),       // effective default when the adapter default is not wanted
  strengths, limits, jevText: z.string().max(160), sources,
});

modelStatSchema = z.object({
  source: z.enum(['benchmark']), round: z.string(), measuredOn: isoDate, file: z.string(),
  provider, model /* card id */, agentModel /* raw ACP id */, effort: nullable,
  role: z.enum(['direct', 'scout', 'architect', 'builder', 'critic']), category: cardCategorySchema,
  n: positive int, passed: int ≤ n, meanCostUsd, costSource, meanWallMs, sharedCredit: int ≤ n,
});

modelCardViewSchema   // what GET /api/model-cards returns: card, provider card, stats by category, staleness flags, jevText
```

- `vendorCardsFileSchema` wraps `{ schemaVersion: 1, checkedAt, providers, cards }`.
- Contract tests parse both JSON files, so a malformed edit fails `pnpm check`.

### Where the cards live

- **Vendor facts: a versioned file in the repo.** It lives at `apps/server/src/model-cards/vendor-cards.json`, is parsed with `vendorCardsFileSchema` at start-up, and fails loudly if invalid. A price or model change is a reviewed diff with new `sources[].checkedAt` dates. The GLM card is added from `docs/reference/zai/GLM_NOTES.md` in Phase 2.
- **Measured stats: a database table.** Migration `00NN_model_stats.sql`, using the next free number at build time (0030 today, unless the GLM work takes it):

  ```sql
  create table model_stats (
    source text not null, round text not null, measured_on date not null, file text not null,
    provider text not null, model text not null, agent_model text not null, effort text,
    role text not null, category text not null,
    n int not null check (n > 0), passed int not null check (passed between 0 and n),
    mean_cost_usd numeric not null, cost_source text not null, mean_wall_ms int not null,
    shared_credit int not null check (shared_credit between 0 and n),
    recorded_at timestamptz not null default now(),
    primary key (source, round, provider, agent_model, effort, role, category)
  );
  ```

  - It is global, not per workspace, because a benchmark measures models, not a user.
  - `measured-seed.json` is upserted by the same ingest function when the API starts, so a fresh database has the existing rounds and a re-run changes nothing.
  - Rows are keyed per round, so a round is replaced, never double-counted.

- **`usage/prices.ts` reads prices from the cards** (Phase 2): `priceFor` looks up the card by `match`, so one table serves estimates and Jev. The current Codex numbers match the cards exactly.

### Compact card text for Jev

Jev is a small, fast model, and every option criterion is text it reads, so each option gets one line of at most **160 characters**. `cardText(card, stats, category)` builds it, and a unit test checks the budget for every card and every category. The pieces are, in order:

1. the label
2. the tier
3. the speed
4. the input and output price
5. the blurb
6. at most one measured stat

The line is cut at whole pieces from the end, never mid-word. Real output:

```
Haiku 4.5: small tier, fastest, $1/$5 per M; fastest, cheapest; quick fixes, sub-agent work; bench fix 6/6 ~$0.02 11s   (117)
Sonnet 5: mid tier, fast, $2/$10 per M; everyday coding and agentic tool use; bench fix 24/24 ~$0.08 27s               (104)
Opus 5.5: top tier, moderate, $4/$20 per M; long agentic coding, large refactors, planning; bench plan 10/10 ~$0.17 37s (119)
Fable 5.1: frontier tier, slower, $10/$50 per M; hardest long-horizon work; slow and costly                            (91)
6 Sol: mid tier, fast, $2/$10 per M; complex coding and agentic work                                                   (68)
```

Rules for the measured piece:

- **Minimum sample.** A stat is shown only when n ≥ 3 for that model, effort-agnostic role group and category.
- **Role groups.** Builder and direct rows are one group, Architect rows are plan, and Critic rows are review.
- **Freshness.** A stat is shown only when it was recorded against the card's current label (see Stale data).
- **Which category.**
  - In the intake batch, the intent is unknown when the model question is asked (same call), so the category with the most samples is used.
  - In route calls, the intake's intent maps to a card category (question/research/chat/docs → question; bug_fix/debugging → fix; feature/setup → feature; refactor; review), and destructive risk overrides it.
  - The Architect route uses plan, and the Critic uses review.

Where the text goes:

- **Intake** (`intake-questions.ts`, `routingQuestions`):
  - `provider` criteria become each provider card's `jevText` (≤ 160) instead of the bare name.
  - `model_<provider>` criteria become `cardText` instead of `label: description`. The adapter description is used only when there is no card.
  - `effort_<provider>` instructions gain the chosen-provider effort note, for example "Opus 5.5 defaults to medium; Haiku 4.5 ignores effort" (≤ 160).
- **Routes** (`jev-questions.ts`, `buildRouteQuestions`): the same card text per model option, with the slot's category.
- **The Architect route** asks through the same builder with category `plan`, so Jev sees "Opus 5.5 … bench plan 10/10 ~$0.17" next to "Sonnet 5 … bench plan 4/4 ~$0.12". A provider's frontier cards are offered only when "Allow frontier models" is on for that provider (see below).

What it costs, and what gets pinned:

- **Cost.** About 7 options × 160 characters, roughly 300 more input tokens per call: about $0.000013 per call at $0.042 per million tokens.
- **Pinned keys.** `intake-questions.test.ts` and `jev-questions.test.ts` pin the new criteria text, as JEV.md requires for any new field sent.
- **Privacy.** No new data leaves the machine: cards are public vendor facts and aggregate benchmark numbers.

### Tiers from cards

How tiers are assigned (explicit per card in `vendor-cards.json`, reviewed with each price change):

- **frontier:** the vendor's most capable model, positioned for the hardest or longest-running work, and priced at least twice the vendor's recommended default for complex work.
- **top:** the vendor's recommended default for complex or agentic coding work, or an older generation's flagship.
- **mid:** the vendor's everyday coding model.
- **small:** the vendor's fastest and cheapest model.

| Card                 | Tier         | Why                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fable 5.1            | frontier     | "Most capable model open to all customers"; the choosing guide says to move to it when Opus at `xhigh` or `max` falls short; $10/$50, 2.5x Opus 5.5                                                                                                                                       |
| Opus 5.5             | top          | "start with Claude Opus 5.5 for most workloads"; $4/$20                                                                                                                                                                                                                                   |
| Sonnet 5             | mid          | "speed and capability for everyday coding"; $2/$10                                                                                                                                                                                                                                        |
| Haiku 4.5            | small        | "fastest", lowest price; $1/$5                                                                                                                                                                                                                                                            |
| **6 Astra**          | **frontier** | "Our most capable model, built for the hardest end-to-end work"; $10/$50, the same as Fable 5.1 and 5x 6 Sol. The Codex docs recommend 6 Sol for "everyday coding and sophisticated tasks", so Sol is OpenAI's default for coding work and Astra sits above it, as Fable does above Opus. |
| 6 Sol                | mid          | Codex's everyday coding model; $2/$10, the same price as Sonnet 5                                                                                                                                                                                                                         |
| 6 Luna               | small        | "most efficient"; $0.10/$0.50                                                                                                                                                                                                                                                             |
| GPT-5.6 Sol, GPT-5.5 | top          | older generations' flagships at $4/$20 and $5/$30, under half of Astra's price; not offered by Codex today                                                                                                                                                                                |
| GPT-5.6 Terra        | mid          | "balance intelligence and cost"                                                                                                                                                                                                                                                           |
| GPT-5.6 Luna         | small        | "cost-sensitive, high-volume"                                                                                                                                                                                                                                                             |

What follows from the table:

- **Codex has no top tier today.** Its ladder is 6 Luna then 6 Sol. So Codex's rule-based top tier (the Critic's fallback and escalation) is 6 Sol, and a Codex route reaches 6 Astra only through the frontier gate below. Before cards, the regex made Astra the top tier, so escalation from Sol could reach it.
- **Codex's own adapter default is 6 Astra.** The effective default (next section) replaces it with 6 Sol, so an unpinned Codex chat never runs Astra by accident.

The lookup:

- **Lookup.** `modelTier(model)` looks the card up (`match.ids` first, then an exact `match.labels` hit) and returns small 0, mid 1, top 2, frontier 3.
- **Label mismatch.** An id match whose live label differs from every card label (say `sonnet` becomes "Sonnet 5.5") counts as **no card**.
- **Fallback.** With no card, the old regex is the fallback, so unknown or renamed models keep today's behaviour. The fallback is recorded (`tierSource: 'card' | 'pattern' | 'none'`) on the route decision and shown in Settings. The regex never returns frontier.
- **Frontier stays off the automatic ladder.** `tierLadder`, `topTier`, `middleTier` and `oneTierUp` use small, mid and top only. So the Architect's rule pick stays Opus 5.5, and neither escalation nor a rule ever moves to a frontier price.
- **`notPricier`.** It uses card tiers first, then compares card prices when tiers are equal (so `gpt-5.6-sol` is pricier than `gpt-6-sol`).
- **Several models in one tier.** When a provider offers more than one card in a tier, the ladder takes the first in the card file's order (newest generation first).

### Effective default model (decided September 26, 2026)

Codex's adapter reports 6 Astra (frontier, $10/$50) as its default, so every unpinned Codex chat, and every Codex run that falls back to the "agent default", ran the most expensive model. The effective default now comes from the cards.

- **The rule.** `effectiveDefaultModel(provider, snapshot, cards)` (pure, in `model-cards/`) works in this order:
  1. The provider card's `everydayModel`, when the snapshot offers it. Codex's is `gpt-6-sol`. Claude's is `null`: its adapter default ("Default (recommended)", which resolves to Opus 5.5) is top tier and matches the vendor's own advice to start with Opus 5.5, so Claude is unchanged.
  2. Otherwise the adapter's default, unless it resolves to a frontier card.
  3. Otherwise the highest non-frontier model on the provider's ladder.
  4. Otherwise the adapter's default as today (no cards match).

  A provider without cards (Z.ai until its card lands) keeps the adapter default.

- **Where it applies.** Once, in `getCapabilities` (`persistence/chat-settings.ts`), so cached rows get it too. The snapshot keeps the adapter's value as a new optional `agentDefaultModel`, and `defaultModel` becomes the effective one. Every reader then follows without its own logic:
  - the run settings in `api/routes.ts`, which send the model explicitly, so the adapter never falls back to Astra
  - the composer picker (`model-options.ts`)
  - Provider defaults (`ProviderDefaults.tsx`)
  - the connection default chosen at setup (`persistence/setup.ts`, today `models[0]`), which switches to the same function
- **Picker.** The effective default is labelled "6 Sol (default)" in the model picker and in Provider defaults. Astra is listed as "6 Astra" with no default mark.
- **Records.** `runs.used_model` is recorded as usual from the applied session settings, so a run that used the effective default reads `gpt-6-sol`.
- **Astra stays reachable:**
  - by pinning it in the picker or Provider defaults, or
  - on Auto through the Codex frontier switch at 0.95 or more.

### Allow frontier models, per provider (decided September 26, 2026)

- **The setting.** One "Allow frontier models" switch per connected provider, all off by default.
  - Stored as `profiles.allow_frontier jsonb not null default '{}'` in the same migration as `model_stats`, for example `{"claude": false, "codex": true, "zai": false}`. A missing key means off.
  - It lives on the profile rather than on the provider connection, so reconnecting a provider doesn't reset it. The API validates it with `z.record(providerIdSchema, z.boolean())`.
  - A provider with no frontier card (Z.ai until its card says otherwise) shows no switch.
- **Settings copy** (Settings → Models, at the top of each provider's group):
  - Claude: "Allow frontier models. Lets Jev choose Fable 5.1 on Auto when it is very sure (0.95). Pinned chats can always use it."
  - Codex: "Allow frontier models. Lets Jev choose 6 Astra on Auto when it is very sure (0.95). Codex only reads here, so this applies to Scouts, Architects and Critics, never to Builders."
- **Off, for a provider:**
  - That provider's frontier cards are left out of the `model_<provider>` and `model_<slot>` options sent to Jev, so Jev cannot pick one.
  - A chat pinned to a frontier model still runs it, as any pinned model does.
  - `autoWouldUse` then records a non-frontier pick.
- **On, for a provider:** that provider's frontier cards are offered, and a Jev pick of one acts only when its confidence is at least **0.95** (`ACT_AT_FRONTIER` in `gate.ts`).
  - The bar applies at every risk and level, including read-only (0.75 otherwise) and cheaper-pick routes (0.8 otherwise). A frontier pick is never a downgrade.
  - Below 0.95 the rule's pick runs, and the decision reads as a fallback:
    - Opus 5.5 for a Claude Architect
    - the chat's model for Builders
    - 6 Sol for a Codex Critic
  - Destructive Architect routes keep the rule's tier (top tier, or Sonnet for destructive work that names its files or a narrow scope, round 7), so Jev's frontier pick is recorded but never applied there.
  - Escalation (`oneTierUp`) never reaches frontier, even when the setting is on.
- **Codex is read-only in our harness** (no Do, see the provider card). So a Codex frontier pick can only apply to the read-only roles: Scout, Architect and Critic. Builders never run on Codex, whatever the setting. In practice today that means the Critic (Codex reviews Claude work) and the Scout of a Codex Ask chat. An Architect runs only in Do orchestrations, which stay on Claude while Codex has no Do.
- **Recorded like every other Jev decision.**
  - Each route that offered or picked a frontier model stores its gate in the `run_advice` route row with `actAt: 0.95`.
  - The `answer` gains `frontier: { provider, allowed: boolean, offered: boolean, picked: boolean }`, so a benchmark can count how often Jev reached for a frontier model and whether it passed.
  - The dispatch tooltip reads, for example, "Jev picked Fable 5.1 at 0.91 · frontier needs 0.95 · ran Opus 5.5", or "Frontier off for Claude" when Jev wasn't offered it.
- **The intake's model pick** (Scout and the in-place Builder) uses the same bar: `routeWorker` gates a frontier pick at 0.95 before the usual gate.

### Benchmark runner writes measured stats

- **When.** `scripts/bench` already writes `docs/benchmarks/<date>.json` with every agent's provider, model, effort, role, cost and duration. It runs against an isolated test database, so stats are written in a separate step, not in-run.
- **How.** `ingestBenchmark(db, file)` (new, `apps/server/src/model-cards/ingest.ts`, pure grouping plus one upsert):
  - maps each task to a category (a `category` field on each `BenchTask`, replacing the mapping table above)
  - maps each agent's model to a card
  - groups rows, and upserts per round
- **Entry points.**
  - `pnpm bench:ingest <file…>` runs it against `DATABASE_URL`.
  - `bench:harness` calls it at the end unless `--no-ingest` is passed.
  - The seed file is regenerated from all ingested rounds with `pnpm bench:ingest --write-seed`.
- **Round 4 and later.** Round 4 and the lean A/B were not saved as round JSON. From the next round on, every round is ingested.

### Settings → Models

- **Where.** A new "Models" section in `SettingsDialog` (a tab next to Usage), read from `GET /api/model-cards`: the cards for connected providers, their stats and staleness.
- **Per provider:**
  - the provider card (Do, asks, sandbox, resume, review, cold start, cost source)
  - a list of model cards: label, tier chip, speed, price, context and max output, efforts with the default, strengths, weak spots, and sources with their checked dates
- **Measured.** Each card has a small table by category (n, pass, mean cost, mean wall, rounds). n < 3 is labelled "anecdotal", and a model with no rows says so.
- **"What Jev reads".** A disclosure per card shows the exact compact line and its character count, and the provider line.
- **Accessibility.** Tier and staleness chips use semantic theme tokens, text is never shown by colour alone, and the section is a keyboard-navigable list. Each provider group starts with its own "Allow frontier models" switch (a labelled checkbox-style switch with its description tied through `aria-describedby`). It must pass `pnpm a11y:contrast` in all themes and has a hermetic browser test using the fake capability snapshot.

### "Why this model" in the dispatch tooltip

- **What it shows.** The advice or route tooltip gains one line per pick, for example:
  - "Why Sonnet 5: Jev 0.86 · mid tier · bench fix 24/24 ~$0.08"
  - "Why Opus 5.5: rule top tier (vague request) · Jev picked Haiku 4.5 at 0.32, below the gate"
- **Where it comes from.** The route decision already stores the pick, the rule, the gate and Jev's pick. Phase 2 adds `tierSource` and the `cardText` that Jev saw for the chosen option to `answer`, so the tooltip shows the stored record and not today's card.

### Stale data

- **Vendor facts.** `checkedAt` is per source.
  - After 60 days Settings shows "Checked N days ago", and the card stays in use.
  - After 120 days the price and blurb are dropped from Jev's line (label, tier and speed stay), because an old price is worse than none.
  - A dev-only check (`pnpm model-cards:check`) lists expired sources. There is no automatic network refresh, because vendor pages are HTML and change shape.
- **Retirement.** Once a card's `retiresNotBefore` has passed, Settings warns on that model and Jev's line adds "retiring". Haiku 4.5 hits this on October 15, 2026.
- **Label drift.** A capability snapshot label that matches no card label means the card is not applied (tier falls back to the pattern), and Settings shows "No card for Sonnet 5.5". This covers aliases such as `sonnet` and `opus[1m]` moving to a new model.
- **Measured stats.**
  - Only rows recorded under the card's current label count; `agent_model` plus `measured_on` against the card's first `checkedAt` decides this.
  - Rows older than 90 days are shown in Settings but left out of Jev's line.
  - Only a new round replaces them.
- **Models without cards** (a new Codex model, and GLM until its card lands) keep today's behaviour everywhere: `label: description`, the regex tier, and no stats.

## Built (September 26, 2026)

Everything in the design landed, with these specifics and deviations:

- **Code.**
  - `packages/contracts/src/model-cards.ts` holds the schemas, including `allowFrontierSchema` and the `GET /api/model-cards` view.
  - `apps/server/src/model-cards/` has:
    - `cards.ts`: loading, provider-scoped matching, `effectiveDefaultModel`
    - `card-text.ts`: Jev's lines, stat selection, staleness
    - `categories.ts`: intent to card category
    - `ingest.ts`: bench rounds and the seed
    - `view.ts`
    - `why.ts`: the route's `why` line and `frontier` record
  - Also:
    - `persistence/model-stats.ts`
    - `api/model-card-routes.ts`: `GET /api/model-cards` and `PUT /api/model-cards/frontier/:provider {allowed}`
    - migration `0030_model_stats.sql`, which also adds `profiles.allow_frontier`
- **Z.ai.** The GLM tier table in `tiers.ts` is gone: Z.ai's two cards (GLM-5.3-Flash small, GLM-5.3 top) come from `GLM_NOTES.md`, and a `zai` provider card is added.
  - Cards are matched per provider, label first, because Z.ai's adapter ids are Claude's slot names (`opus`, `haiku`).
  - `usage/prices.ts` now builds its table from the Codex and Z.ai cards, with `cacheOutsideInput` for Z.ai.
- **Tiers.** `modelTier`, `tierLadder`, `topTier`, `middleTier` and `oneTierUp` take the provider and use the card, with the regex as the fallback. `tierInfo` also reports the source.
- **Provider line.** The provider line's Do part comes from the live catalog (`doAvailable`), so it follows Codex Do when that lands.
- **Measured stats.** Stats are keyed by card id. A relabelled model therefore counts old stats only until they pass the 90-day limit; exact per-label counting is left out.
- **Frontier gate.** `frontierGate` acts at 0.95 or more and otherwise falls back, and never asks. `routeGate` applies it to every Builder, Scout, Critic and Architect route whose Jev pick is frontier.
- **Where the why line shows.** Route decisions store `why`, `tierSource` and, when a frontier model was involved, `frontier`. `DispatchLine` lists every route's `why` in its tooltip, named by crew member.
- **Effective default.**
  - `getCapabilities` returns the effective `defaultModel` plus `agentDefaultModel`.
  - `saveConnection` picks the effective default for a new connection.
  - The model picker and Provider defaults mark it "(default)".
  - An existing connection's saved model is left alone. The user's Codex connection keeps `gpt-6-luna`.

Tests:

- **Unit:** `model-cards/{cards,card-text,frontier,ingest}.test.ts` and `apps/web/src/models/model-card-stats.test.ts`, plus `crew/why-lines.test.ts`, the `optionLabel` test, and updated `intake-questions`, `policy` and `prices` tests.
- **DB:** `test/model-cards.db.test.ts` covers the idempotent seed, re-ingest replacing a round, the API view, the frontier switch reaching Jev's candidates, and an unpinned Codex chat sending `gpt-6-sol` while an Astra pin sends Astra.
- **Browser:** `tests/browser/models.spec.ts` covers the cards, measured table, "What Jev reads" and the per-provider switches by keyboard, persisted across a reload. `accessibility.spec.ts` now scans Settings → Models in every theme.

### Live check: Jev with and without cards

Five tasks through the intake and, for the three that plan, an Architect route call; 20 calls, 20,200 input tokens, about $0.0008. Candidates: Claude (Opus 5.5, Fable 5.1, Sonnet 5, Haiku 4.5) and Codex (6 Astra, 6 Sol, 6 Luna).

- **Without cards:** today's text, all models offered.
- **With cards:** card lines, measured stats, frontier off, and Codex described as read-only.

| Task                  | Provider (without → with)    | Claude model              | Codex model           | Architect                    |
| --------------------- | ---------------------------- | ------------------------- | --------------------- | ---------------------------- |
| typo fix              | claude 0.19 → claude 0.97    | haiku 0.97 → haiku 1.00   | luna 0.99 → luna 1.00 | –                            |
| multi-file refactor   | claude 0.46 → claude 0.98    | sonnet 0.35 → sonnet 0.47 | sol 0.76 → sol 0.26   | sonnet 0.43 → sonnet 0.55    |
| destructive migration | **codex 0.29 → claude 0.98** | sonnet 0.63 → sonnet 0.53 | sol 0.40 → luna 0.53  | **haiku 0.35 → sonnet 0.40** |
| feature               | **codex 0.12 → claude 0.98** | sonnet 0.74 → sonnet 0.80 | sol 0.57 → luna 0.41  | sonnet 0.42 → sonnet 0.60    |
| review (Ask)          | **claude 0.32 → codex 0.87** | opus 0.31 → sonnet 0.58   | sol 0.54 → sol 0.65   | –                            |

- **The provider choice stops being a coin flip.** Confidence rose from 0.12–0.46 to 0.87–0.98. Jev now keeps edits on Claude (the only provider with Do) and sends a read-only review to Codex.
- **Claude model picks barely moved.** Confidence changed by −0.10 to +0.27. The Architect pick is Sonnet 5 in all three planned tasks, at 0.40 to 0.60, still below the 0.9 gate, so the rule's Architect runs as before. Without cards, Jev picked Haiku to plan the destructive migration.
- **Codex picks moved toward 6 Luna** on the destructive and feature tasks, at low confidence (0.41 to 0.53, below every gate). That likely follows from its "cheapest" line. Worth watching once Codex runs Builders.
- **Frontier models were never picked**, as expected with frontier off. In the without-cards run, where they were offered, Jev never picked Fable or Astra either.
- **Cost of the extra text:** about 83 more input tokens per intake call (1,629 to 1,712).

## Phase 2 plan and tests

1. **Contracts.** Add `model-cards.ts` with a contract test that parses both JSON files.
2. **Server.** Add:
   - `model-cards/` (load, match, `cardText`, `ingest`)
   - the `model_stats` migration (plus `profiles.allow_frontier`) with the seed upsert on start-up
   - the effective default model from the cards (`everydayModel`, applied in `getCapabilities`, with `agentDefaultModel` kept)
   - the per-provider frontier gate (0.95) and the setting's API (`PATCH /api/profile {allowFrontier}`)
   - `GET /api/model-cards`
   - tiers from cards with the regex fallback
   - `priceFor` from cards
   - card text in the intake, route and Architect questions
   - the GLM card
3. **Bench.** A `category` on each task, `bench:ingest`, and ingest at the end of `bench:harness`.
4. **Web.** Settings → Models, the "why" line in the dispatch tooltip, and "(default)" on the effective default in the model picker and Provider defaults.
5. **Tests:**
   - Unit:
     - tiers from cards (Fable is frontier and off the ladder, `gpt-5.6-sol` is top, label drift falls back, unknown ids fall back)
     - the frontier gate, per provider: Codex on and Claude off offers 6 Astra but not Fable; on, a frontier pick acts at 0.95 and falls back at 0.94 (read-only and cheaper-pick routes too); destructive keeps Opus; escalation never reaches frontier (Codex Sol has no tier up); the gate and `frontier` are recorded
     - 6 Astra is frontier, so the Codex ladder is Luna then Sol
     - `effectiveDefaultModel`: Codex with the adapter default Astra gives 6 Sol; Claude keeps its adapter default; a frontier adapter default without `everydayModel` gives the top non-frontier model; no cards keeps the adapter default
     - `cardText` ≤ 160 for every card × category, with n < 3 hidden
     - question text pinned
     - ingest grouping from a fixture round
   - DB:
     - the seed is idempotent
     - re-ingesting a round replaces it
     - the API view
     - an unpinned Codex chat sends `gpt-6-sol` in its run settings and records it as `used_model` (fake agent whose default is Astra); a chat pinned to Astra still runs Astra
   - Browser: a hermetic test of the Models view (keyboard, the "What Jev reads" disclosure, stale and no-card states, and the per-provider frontier switches with Codex on and Claude off saved and reloaded).
   - Existing: `pnpm check`, `pnpm test:db`, `pnpm test:browser` and `pnpm a11y:contrast`.
6. **Live** (≤ $0.30, Jev only): 5 sample tasks through the intake and an Architect route call, with and without card text. The comparison covers the picks, confidences and the gate.

## Open questions

None at the moment.
