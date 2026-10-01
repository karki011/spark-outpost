# Model cards

Model cards hold vendor facts and our own benchmark numbers per model. See [JEV.md](JEV.md) for Jev's questions and [HARNESS_PLAN.md](HARNESS_PLAN.md) for the routing rules that use tiers.

> **Round 10 (September 27, 2026): routing is rules-only.** A pinned model always runs; on Auto the rules pick the chat's model, the middle tier for a trivial edit and the top tier for destructive or complex work, and the harness never picks the fast tier or a retiring model ([ROUTING_PLAN.md §4](ROUTING_PLAN.md#4-policy-that-stays-in-code)). Jev answers one observed `tier` question (small, mid or top of the chat's provider, with the card lines below as option text) and its pick is recorded as "Jev would have used …" for the Harness tab's rule-vs-Jev comparison, never applied. The provider, per-provider model and effort questions, the routing gates and the frontier gate are gone, and so is the "Allow frontier models" switch (`profiles.allow_frontier`, dropped by `0039_lean_harness.sql`): pinning a frontier model still works. Cards still supply prices, tiers, the effective default model, Settings → Models and the tier question's text. Since September 30 the Builder's route score also reads each card's tier (expected quality), its input, cache-read, cache-write and output prices (the task's cost and the cost of leaving a warm session) and the measured Builder rows ([ROUTING_PLAN.md §12](ROUTING_PLAN.md#12-cache-aware-routing-and-the-route-score-september-30-2026-policy-route-score-1-cache-aware)). The sections below describe the cards as they work today.

## Why

Before cards, when Jev picked the provider, model and effort for every agent, it saw only:

- the provider name
- each model's id, label and the adapter's one-line description (for example "Sonnet 5 · Efficient for routine tasks")
- the effort names

Tiers came from a regex in `orchestration/tiers.ts` (`haiku|luna` is 0, `sonnet|sol` is 1, `opus|astra` is 2), now only the fallback. So Jev knew nothing about price, speed, limits or how each model did on our own benchmark. The regex also gets some models wrong:

- **Fable 5.1 (`claude-fable-5-1[1m]`) has no tier.** It is left out of the ladder, and `notPricier` treats it as unknown.
- **`gpt-5.6-sol` gets the middle tier**, but it is the 5.6 family's flagship ($4/$20, above 6 Sol's $2/$10).
- **Nothing knows that Haiku 4.5 does not support the API effort parameter**, yet routes read "Haiku 4.5 · low".

A model card holds the vendor facts plus what we measured ourselves. Jev gets a short version of each card, and tiers come from the cards.

## Data gathered

Files:

- `apps/server/src/model-cards/vendor-cards.json`: vendor facts for the Claude, Codex and Z.ai models and their provider cards
- `apps/server/src/model-cards/measured-seed.json`: 30 measured rows from the three benchmark rounds that have JSON

### Vendor facts (checked September 26, 2026)

Prices are USD per million tokens (input / cached input / output). "Ids we see" are the values the ACP adapters offer (from `provider_capabilities`, captured September 26). The cards name the GPT-6 family "GPT-6 Luna", "GPT-6 Sol" and "GPT-6 Astra" so it reads as a family next to GPT-5.6 in Settings → Models; the Codex agent offers them as "6 Luna", "6 Sol" and "6 Astra", which the cards still match.

| Model         | Ids we see                    | Tier     | Price              | Context / max output | Speed (vendor)             | Reasoning                                       | Knowledge |
| ------------- | ----------------------------- | -------- | ------------------ | -------------------- | -------------------------- | ----------------------------------------------- | --------- |
| Haiku 4.5     | `haiku`                       | small    | 1 / 0.10 / 5       | 200K / 64K           | fastest                    | extended thinking; **API effort not supported** | Feb 2025  |
| Sonnet 5      | `sonnet`                      | mid      | 2 / 0.20 / 10      | 1M / 128K            | fast                       | adaptive; low to max, default high              | Jan 2026  |
| Opus 5.5      | `opus[1m]`                    | top      | 4 / 0.20 / 20      | 1M / 128K            | moderate                   | always thinks; low to max, default **medium**   | Jun 2026  |
| Fable 5.1     | `claude-fable-5-1[1m]`        | frontier | 10 / 0.25 / 50     | 1M / 128K            | slower                     | always thinks; low to max, default high         | Jun 2026  |
| GPT-6 Luna    | `gpt-6-luna`                  | small    | 0.10 / 0.01 / 0.50 | 1.05M / 128K         | fast (reasoning "High")    | none to max, default medium                     | May 2026  |
| GPT-6 Sol     | `gpt-6-sol`                   | mid      | 2 / 0.20 / 10      | 1.05M / 128K         | fast (reasoning "Highest") | none to max, default medium                     | Apr 2026  |
| GPT-6 Astra   | `gpt-6-astra` (Codex default) | frontier | 10 / 1 / 50        | 1.05M / 128K         | fast (reasoning "Highest") | low to max, no default stated                   | Apr 2026  |
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
| Do mode              | yes                                                                                                                     | yes, since September 26: the patched `ask-every-action` mode (see [CODEX_DO.md](CODEX_DO.md))             |
| Asks before commands | every edit and command, read-only ones included                                                                         | only for actions outside its sandbox                                                                      |
| Sandbox              | none at OS level; tools limited, secret files denied, Bash unsandboxed after approval, its tools bypass our path policy | true read-only sandbox, but it can read the whole disk; the chat file editor can still write under `/tmp` |
| Resume               | yes, across processes                                                                                                   | yes (`thread/resume`)                                                                                     |
| Review use           | yes                                                                                                                     | yes: the default Critic for a Claude chat; slow on R1 (over a minute)                                     |
| Cold start           | 8–10 s                                                                                                                  | 4–9 s                                                                                                     |
| Cost                 | reported                                                                                                                | estimated from tokens                                                                                     |

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
  reasoning: z.object({ mode, efforts: z.array(z.string()), defaultEffort: nullable, note,
    effortKeepsCache?: boolean }), // true: an effort change keeps the prompt cache (Opus 5.5), so a Builder session resumes across it
  strengths: z.array(z.string()).max(4), weakSpots: z.array(z.string()).max(4),
  blurb: z.string().max(60),                  // hand-written, goes into Jev's text
  knowledgeCutoff: z.string(), retiresNotBefore: z.string().nullable(),
  retired: z.boolean().optional(),            // set once retiresNotBefore has passed
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

- **Vendor facts: a versioned file in the repo.** It lives at `apps/server/src/model-cards/vendor-cards.json`, is parsed with `vendorCardsFileSchema` at start-up, and fails loudly if invalid. A price or model change is a reviewed diff with new `sources[].checkedAt` dates. Z.ai's cards (GLM-5.3-Flash small, GLM-5.3 top) and its provider card come from `docs/reference/zai/GLM_NOTES.md`; cards are matched per provider, label first, because Z.ai's adapter ids are Claude's slot names (`opus`, `haiku`).
- **Measured stats: a database table.** Migration `0030_model_stats.sql`:

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

- **`usage/prices.ts` reads prices from the cards:** `priceFor` looks up the card by `match`, so one table serves estimates and Jev (with `cacheOutsideInput` for Z.ai).

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
- **Which category.** The intake's `tier` question has no category yet (it is asked in the same call as the intent), so the category with the most samples is used.

Where the text goes:

- **Intake** (`advisor/intake-questions.ts`, `tierQuestion`): each option of the observed `tier` question (small, mid, top of the chat's provider) carries the model's card line (`modelOptionText`). The adapter's `label: description` is used only when there is no card.
- **Settings → Models:** the "What Jev reads" disclosure shows the same line (`model-cards/view.ts`).

Pinning and privacy:

- **Pinned keys.** `intake-questions.test.ts` pins the criteria text, as JEV.md requires for any new field sent.
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

- **Codex has no top tier today.** Its ladder is 6 Luna then 6 Sol. So Codex's rule-based top tier (the Critic's fallback and escalation) is 6 Sol, and Codex runs 6 Astra only when the user pins it.
- **Codex's own adapter default is 6 Astra.** The effective default (next section) replaces it with 6 Sol, so an unpinned Codex chat never runs Astra by accident.

The lookup:

- **Lookup.** `modelTier(model)` looks the card up (`match.ids` first, then an exact `match.labels` hit) and returns small 0, mid 1, top 2, frontier 3.
- **Label mismatch.** An id match whose live label differs from every card label (say `sonnet` becomes "Sonnet 5.5") counts as **no card**.
- **Fallback.** With no card, the old regex is the fallback, so unknown or renamed models keep today's behaviour. `tierInfo` reports which one decided (`'card' | 'pattern' | 'none'`), and Settings → Models lists models with no card. The regex never returns frontier.
- **Frontier stays off the automatic ladder.** `tierLadder`, `topTier`, `middleTier` and `oneTierUp` use small, mid and top only. So neither escalation nor a rule ever moves to a frontier price.
- **`notPricier`.** It uses card tiers first, then compares card prices when tiers are equal (so `gpt-5.6-sol` is pricier than `gpt-6-sol`).
- **Several models in one tier.** When a provider offers more than one card in a tier, the ladder takes the first in the card file's order (newest generation first).

### Effective default model

Codex's adapter reports 6 Astra (frontier, $10/$50) as its default, so every unpinned Codex chat, and every Codex run that falls back to the "agent default", ran the most expensive model. The effective default now comes from the cards.

- **The rule.** `effectiveDefaultModel(provider, snapshot, cards)` (pure, in `model-cards/`) works in this order:
  1. The provider card's `everydayModel`, when the snapshot offers it. Codex's is `gpt-6-sol`. Claude's is `null`: its adapter default ("Default (recommended)", which resolves to Opus 5.5) is top tier and matches the vendor's own advice to start with Opus 5.5, so Claude is unchanged.
  2. Otherwise the adapter's default, unless it resolves to a frontier or retiring card.
  3. Otherwise the highest non-frontier, non-retiring model on the provider's ladder.
  4. Otherwise the adapter's default as today (no cards match).

  A provider without cards keeps the adapter default.

- **Where it applies.** Once, in `getCapabilities` (`persistence/chat-settings.ts`), so cached rows get it too. The snapshot keeps the adapter's value as a new optional `agentDefaultModel`, and `defaultModel` becomes the effective one. Every reader then follows without its own logic:
  - the run settings in `api/routes.ts`, which send the model explicitly, so the adapter never falls back to Astra
  - the composer picker (`model-options.ts`)
  - Provider defaults (`ProviderDefaults.tsx`)
  - the connection default chosen at setup (`persistence/setup.ts`); an existing connection's saved model is left alone
- **Picker.** The effective default is labelled "6 Sol (default)" in the model picker and in Provider defaults. Astra is listed as "6 Astra" with no default mark.
- **Records.** `runs.used_model` is recorded as usual from the applied session settings, so a run that used the effective default reads `gpt-6-sol`.
- **Astra stays reachable** by pinning it in the picker or Provider defaults.

### Benchmark runner writes measured stats

- **When.** `scripts/bench` already writes `docs/benchmarks/<date>.json` with every agent's provider, model, effort, role, cost and duration. It runs against an isolated test database, so stats are written in a separate step, not in-run.
- **How.** `ingestBenchmark(db, file)` (`apps/server/src/model-cards/ingest.ts`, pure grouping plus one upsert):
  - maps each task to a category (a `category` field on each `BenchTask`, replacing the mapping table above)
  - maps each agent's model to a card
  - groups rows, and upserts per round
- **Entry points.**
  - `pnpm bench:ingest <file…>` runs it against `DATABASE_URL`.
  - `bench:harness` calls it at the end unless `--no-ingest` is passed.
  - The seed file is regenerated from all ingested rounds with `pnpm bench:ingest --write-seed`.

### Settings → Models

- **Where.** A "Models" section in `SettingsDialog` (a tab next to Usage), read from `GET /api/model-cards`: the cards for connected providers, their stats and staleness.
- **Per provider:**
  - the provider card (Do, asks, sandbox, resume, review, cold start, cost source)
  - a list of model cards: label, tier chip, speed, price, context and max output, efforts with the default, strengths, weak spots, and sources with their checked dates
- **Measured.** Each card has a small table by category (n, pass, mean cost, mean wall, rounds). n < 3 is labelled "anecdotal", and a model with no rows says so.
- **"What Jev reads".** A disclosure per card shows the exact compact line and its character count, and the provider line.
- **Accessibility.** Tier and staleness chips use semantic theme tokens, text is never shown by colour alone, and the section is a keyboard-navigable list. It must pass `pnpm a11y:contrast` in all themes and has a hermetic browser test using the fake capability snapshot.

### "Why this model" in the dispatch tooltip

- **What it shows.** The advice or route tooltip gains one line per pick, for example:
  - "Why Sonnet 5: rule trivial → middle tier · mid tier · Jev would have used Opus 5.5"
  - "Why Opus 5.5: pinned in this chat as the orchestrator's model"
- **Where it comes from.** `model-cards/why.ts` (`whyLine`) builds it from the stored route decision: the pick, the rule, the card's tier, any floor or retiring note, and Jev's observed pick (`autoWouldUse`). `DispatchLine` lists every route's why line in its tooltip, named by crew member.

### Stale data

- **Vendor facts.** `checkedAt` is per source.
  - After 60 days Settings shows "Checked N days ago", and the card stays in use.
  - After 120 days the price and blurb are dropped from Jev's line (label, tier and speed stay), because an old price is worse than none.
  - `pnpm model-cards:check` (`scripts/model-cards-check.ts`, logic in `model-cards/check.ts`) runs inside `pnpm check` against today's date. It prints a WARN for every provider or model card whose oldest source is over 60 days old and still exits 0; over 120 days it FAILs. There is no automatic network refresh, because vendor pages are HTML and change shape.
- **Retirement.** A card is retiring from 30 days before its `retiresNotBefore` (`cardRetiring`). From then the harness never picks it for any role, provider and chat defaults skip it, Settings → Models tags it "Retiring <date> · not used by the harness", and Jev's line adds "retiring". A user can still pick it for a chat, with a "retiring on <date>" note on the route. Haiku 4.5 (October 15, 2026) and GPT-5.5 (October 14, 2026) are retiring as of September 28, 2026.
- **Retired.** A card is retired from the day after its `retiresNotBefore`, or whenever it has `"retired": true` (`cardRetired`, `retirementState` in contracts). A retired card is still counted as retiring, so the harness never picks it. The wording changes everywhere: Settings → Models and the chat model picker say "Retired <date>", the details say "Retired <date>", route and floor notes say "retired on <date>", and Jev's line drops the blurb and ends in "retired".
- **The check reminds, the date decides.** Retirement needs no edit to take effect: from the day after `retiresNotBefore`, `retirementState` returns `retired` everywhere (floor, defaults, picker, Jev), so nothing waits on the card being marked. `pnpm model-cards:check` prints a WARN (not a FAIL, since September 30, 2026) for any card whose `retiresNotBefore` has passed while it has no `"retired": true`: from October 15, 2026 for GPT-5.5 and from October 16, 2026 for Haiku 4.5. When convenient, set `"retired": true`, rewrite its blurb, strengths and weak spots in the past tense, re-check `checkedAt`, and update the browser specs that freeze the clock at September 29 and expect "Retiring Oct 15" (`models.spec.ts`, `permission-modes.spec.ts`), because `"retired": true` wins over their frozen clock.
- **Label drift.** A capability snapshot label that matches no card label means the card is not applied (tier falls back to the pattern), and Settings shows "No card for Sonnet 5.5". This covers aliases such as `sonnet` and `opus[1m]` moving to a new model.
- **Measured stats.**
  - Only rows recorded under the card's current label count; `agent_model` plus `measured_on` against the card's first `checkedAt` decides this.
  - Rows older than 90 days are shown in Settings but left out of Jev's line.
  - Only a new round replaces them.
- **Models without cards** (for example a new Codex model) keep today's behaviour everywhere: `label: description`, the regex tier, and no stats.

## Code

- `packages/contracts/src/model-cards.ts`: the schemas and the `GET /api/model-cards` view.
- `apps/server/src/model-cards/`: `cards.ts` (loading, provider-scoped matching, retirement, `effectiveDefaultModel`), `card-text.ts` (Jev's lines, stat selection, staleness), `ingest.ts` (bench rounds and the seed), `check.ts` (`pnpm model-cards:check`), `view.ts` and `why.ts`.
- `orchestration/tiers.ts`: `modelTier`, `tierLadder`, `topTier`, `middleTier` and `oneTierUp` take the provider and use the card, with the regex as the fallback; `tierInfo` reports the source.
- `persistence/model-stats.ts`, `api/model-card-routes.ts`, migration `0030_model_stats.sql`.
- Web: `apps/web/src/models/` (Settings → Models).

## Open questions

None at the moment.
