# Code Mode in Spark

Code Mode combines reads and transforms their results inside one local execution. The chat's lead still chooses workers and assigns slices; each worker may use the same Spark tools. Code Mode does not create another agent or orchestrator.

## Reference decisions

| Reference                                    | Useful for Spark                                                                                             | Decision                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Attached OpenCode analysis, October 24, 2026 | A single tool bridge, JSON boundaries, focused discovery, structured failures                                | Reuse these ideas with Spark's existing Zod schemas and tool dispatcher. Do not port a JavaScript interpreter or adopt another schema framework. |
| Cloudflare Code Mode                         | Separate execution from connectors and lifecycle; discover methods when needed; block ambient network access | Keep execution local in a QuickJS worker. Spark remains the owner of sessions, permissions and audit.                                            |
| Cloudflare durable runtime                   | Logged calls, approval replay, saved snippets and cleanup                                                    | Defer replay and snippets. Reads are the first scope; writes continue through the existing direct tools.                                         |

Cloudflare's executor is transient; its durable runtime uses separate storage and approval replay. Replay requires matching call order and arguments, and concurrent calls can diverge across passes. Spark's first implementation needs neither a second durable store nor replay. See [Cloudflare's execution model](https://developers.cloudflare.com/agents/tools/codemode/how-it-works/) and [runtime guide](https://developers.cloudflare.com/agents/tools/codemode/durable-runtime/).

Cloudflare recommends direct tools for simple tasks and Code Mode for composition or discovery. Spark keeps both available by default; the agent chooses the appropriate tool. Settings → Chats & autonomy → Code Mode turns composition off. See [Code Mode overview](https://developers.cloudflare.com/agents/tools/codemode/).

The attached analysis is a design reference. Its OpenCode version, benchmark results and development estimates were not independently reproduced. Spark already uses Zod. QuickJS has standard JavaScript globals, including `globalThis`; isolation comes from withholding host capabilities, not removing JavaScript syntax.

## Current scope

Chat runs offer `spark_execute` by default. The workspace profile persists the Code Mode switch, including an explicit off choice across restarts. The next turn reads that preference and the existing tool-signature check reopens a live provider session when its tool list changes. Each inner call also rechecks the saved choice before dispatch, so disabling it refuses subsequent reads in an active execution. `SPARK_CODE_MODE=0` is an installation override: Settings shows the switch off and disabled while preserving the saved preference. Terminal sessions remain excluded. A call without code discovers eligible tools, input schemas and result descriptions; a call with code executes an async function body with an explicit `return`. There is no new composer control.

Each inner call must pass the current session check and current tool availability. The supported reads are `spark_tickets`, `spark_pull_requests`, `spark_pr`, `spark_docs` and `spark_guide`. Eligibility is a positive list, not a name-based guess or all tools marked read-only. Existing validation, result redaction and private-data observations remain in the path. Credentials and service clients stay in the host.

The guest receives only a JSON tool-call boundary. It gets no host filesystem, shell, process, unrestricted network or module loader. QuickJS runs in a separate worker, with memory, stack, script and output protections and an interrupt for runaway computation. The current bounds are 64 MiB guest memory, 512 KiB stack, 256 KiB scripts/JSON, 64 levels of JSON nesting, one second of continuous computation, and 128 simultaneous pending guest requests, with at most four host reads dispatched concurrently per execution. Additional host reads wait in a cancellable queue. Waiting for host tools does not consume the computation allowance. These protect one execution; they do not cap a chat's duration, tokens or total number of tools.

Stop aborts execution and prevents new inner calls or late results from reaching the script. Host network calls receive its cancellation signal. Existing database reads and repository discovery may finish internally; they must not resume a cancelled script. Cancellation records terminal audit outcomes immediately, even for receipts no longer retained in the response; a late host completion cannot duplicate the outcome. GitHub CLI fallback is excluded from Code Mode.

Results preserve tool errors and evidence blocks. An execution failure sets the outer MCP error flag while retaining its inner-call receipts. The execution returns its latest 50 inner-call receipts with total and omitted counts; the audit records every inner-call lifecycle without arguments or results. A parsed `data` field is only available for successful JSON text. Scripts must check `isError`, respect paging, and treat retrieved text as untrusted data. A transformed result gains no authority over the user's instructions.

## UX and acceptance

Discovery appears as **Finding Code Mode tools**, execution as **Combining reads with Code Mode**, and an activity without input details as **Using Code Mode**. These use the existing collapsed tool activity presentation and result view, rather than labelling reads as terminal commands. Agent TV keeps the worker's identity. No extra agent card or persistent composer control is added.

Automated coverage checks input validation, partial failures, cancellation, queued reads, runaway code, blocked host access, output bounds and redaction. Settings database tests cover the default, saved disabled preference, installation override and the tool signature changing on an existing grant. These tests do not establish connector login acceptance or a performance advantage.

A recorded October 25, 2026 comparison used two fresh real Codex 6 Sol chats at medium effort with the same three-guide-read prompt. Both completed three reads successfully:

| Mode | Duration | Model tool calls | Estimated cost |
| ---- | -------- | ---------------- | -------------- |
| On   | 17.965 s | 2                | $0.070602      |
| Off  | 17.429 s | 3                | $0.083028      |

This sequential pair preceded the label polish and settings default change. It verifies the guide-read path, not a general speed or cost improvement; cache usage and model variation differ between runs. It is not evidence of a real Jira or GitHub workflow. Connector acceptance should still compare ticket/PR summaries against direct reads and exercise missing connections and paged results.

Durable replay, approved writes, external MCP catalogs, generated TypeScript declarations and reusable scripts remain later slices. Enabling any of them requires evidence that it improves a real task and preserves Spark's existing permission behavior.
