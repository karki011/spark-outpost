# Z.ai GLM notes

What Spark Outpost relies on from the Z.ai docs for the "Z.ai (GLM)" provider. Checked on September 26, 2026, by downloading the raw `.md` pages (the rendered pages summarize badly). The rate-limit page needs a console login and was not readable.

## How we connect

Spark Outpost runs `claude-agent-acp` against Z.ai's Anthropic-compatible endpoint, so Claude Code is the agent and GLM is the model.

| Setting                                         | Value we use                                   | Docs say                                                       |
| ----------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL`                            | `https://api.z.ai/api/anthropic`               | same, on every page that mentions it                           |
| `ANTHROPIC_AUTH_TOKEN`                          | the Z.ai key (sent as `Authorization: Bearer`) | `ANTHROPIC_AUTH_TOKEN`; `ANTHROPIC_API_KEY` is never mentioned |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` / `SONNET_MODEL` | `glm-5.3[1m]`                                  | `glm-5.3[1m]` in the manual-config JSON                        |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`                 | `glm-5.3-flash[1m]`                            | `glm-5.3-flash[1m]`                                            |
| `API_TIMEOUT_MS`                                | `3000000` (50 minutes)                         | `3000000`                                                      |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`      | `1`                                            | `1`                                                            |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW`               | `1000000`                                      | `1000000`, to match the 1M window                              |

- The `[1m]` suffix makes Claude Code use the 1M-token context lane; Z.ai says to upgrade Claude Code if it is rejected. It is stripped when we record `used_model`.
- The page says compatibility was verified with Claude Code 2.0.14; we run 2.1.280 (bundled in claude-agent-acp 0.81.2).

Sources: https://docs.z.ai/devpack/tool/claude, https://docs.z.ai/devpack/latest-model

### Where the brief and the docs disagree

- The brief's base URL and mapping (Opus/Sonnet → `glm-5.3`, Haiku → `glm-5.3-flash`) match the docs' manual-config JSON, except that the docs add the `[1m]` suffix. We follow the docs.
- The same Claude Code page contradicts itself: its bullet list says all three slots default to `GLM-5.3-Flash`. The model-switch guide also maps all three to `glm-5.3-flash[1m]` when you want Flash only. We keep GLM-5.3 as the main model and Flash as the cheap one.
- The Anthropic endpoint is documented on the Coding Plan pages (and the GLM-5.3 page). No page says whether a pure pay-as-you-go key is billed per token there. The GLM-5.3 page also warns that accounts that ever had a Coding Plan "can currently access the model API only through the OpenAI Chat Completion-compatible protocol". A live run is the only check.

## Models

| Model          | ID               | Context | Max output | Input                      | Thinking                                                         |
| -------------- | ---------------- | ------- | ---------- | -------------------------- | ---------------------------------------------------------------- |
| GLM-5.3        | `glm-5.3`        | 1M      | 128K       | text only                  | always on; `reasoning_effort` `low`, `high`, `max` (default max) |
| GLM-5.3-Flash  | `glm-5.3-flash`  | 1M      | 128K       | text, image, video, file   | always on; same effort levels                                    |
| GLM-5.3-FlashX | `glm-5.3-flashx` | 1M      | 128K       | as Flash, faster (200 t/s) | as Flash; not on the Coding Plan                                 |
| GLM-5.2        | `glm-5.2`        | 1M      | 128K       | text                       | dynamic; `reasoning_effort` supported                            |
| GLM-5.1        | `glm-5.1`        | 200K    | 128K       | text                       | dynamic; no `reasoning_effort`                                   |

- Released: GLM-5.3 on 2026-08-18, GLM-5.3-Flash on 2026-08-26, GLM-5.2 on 2026-06-16, GLM-5.1 on 2026-04-07.
- GLM-5.3 is text-only, so an image attachment on GLM-5.3 fails. Flash accepts images.
- The Coding Plan can call only GLM-5.3 and GLM-5.3-Flash.

Sources: https://docs.z.ai/guides/llm/glm-5.3, https://docs.z.ai/guides/vlm/glm-5.3-flash, https://docs.z.ai/guides/llm/glm-5.2, https://docs.z.ai/guides/llm/glm-5.1, https://docs.z.ai/release-notes/new-released, https://docs.z.ai/devpack/faq

## Prices (USD per million tokens, pay as you go)

| Model          | Input | Cached input | Output |
| -------------- | ----- | ------------ | ------ |
| GLM-5.3        | 1.40  | 0.26         | 4.40   |
| GLM-5.3-Flash  | 0.15  | 0.03         | 0.50   |
| GLM-5.3-FlashX | 0.37  | 0.075        | 1.25   |
| GLM-5.2, 5.1   | 1.40  | 0.26         | 4.40   |

- Cache storage is "limited-time free". The caching page says hits cost "usually 50%" of input, but the price table's rates are about 19%; the estimate uses the table.
- The Coding Plan is a subscription with 5-hour and weekly quotas instead of per-token billing. GLM-5.3 uses 3× quota at peak (Monday to Friday, 14:00–18:00 UTC+8) and 1× off-peak; Flash 1.2× and 0.4×. Using up the quota never charges the account balance.
- Spark Outpost estimates every Z.ai run from tokens at the pay-as-you-go rates and labels it `estimated`. Claude Code's own cost figure uses Anthropic prices, so it is ignored. On a Coding Plan the estimate overstates the real charge.

Source: https://docs.z.ai/guides/overview/pricing, https://docs.z.ai/devpack/overview, https://docs.z.ai/devpack/notice/usage-revision

## Limits

- **Rate limits and concurrency:** no public numbers. Concurrency quotas differ by user and plan; excess requests "may fail or need to wait in queue" (https://docs.z.ai/guides/overview/concept-param). The per-key limits are only in the console.
- **Coding Plan quotas:** Lite about 80 prompts per 5 hours, Pro about 400, Max about 1,600 (weekly about 5× that).
- **Tools:** at most 128 functions; `tool_choice` supports only `auto` (https://docs.z.ai/api-reference/llm/chat-completion). Claude Code's tool list for our runs is 0 to 6 tools.

## Thinking

- GLM-5.3 and Flash always think; `thinking.type: disabled` is an API error. Claude Code sends `thinking.type` and `output_config.effort`; on the Anthropic endpoint a disabled toggle becomes `low`, and effort maps none/minimal/low → low, medium/high → high, xhigh/max → max. So Spark Outpost offers Low, High and Max.
- There is no thinking token budget. Interleaved thinking is on; thinking blocks must be sent back with tool results, which Claude Code does. Preserved thinking (`clear_thinking: false`) is on by default on the coding endpoint.

Source: https://docs.z.ai/guides/capabilities/thinking, https://docs.z.ai/guides/capabilities/thinking-mode, https://docs.z.ai/devpack/latest-model

## Context caching

Automatic, no `cache_control` needed and no explicit API. Hits show as `cached_tokens`; the TTL isn't documented (https://docs.z.ai/guides/capabilities/cache).

## Errors

Errors come as `{"error": {"code", "message"}}`. The ones a user will meet:

| HTTP | Code      | Meaning                                                                    |
| ---- | --------- | -------------------------------------------------------------------------- |
| 401  | 1000–1003 | bad, missing or expired key                                                |
| 400  | 1211      | unknown model                                                              |
| 400  | 1261      | prompt too long                                                            |
| 429  | 1113      | no balance or resource package (also a wrong endpoint for the Coding Plan) |
| 429  | 1302      | rate limit                                                                 |
| 429  | 1305      | overloaded                                                                 |
| 429  | 1308–1321 | Coding Plan quota used, expired, or model not in plan                      |

Source: https://docs.z.ai/api-reference/api-code, https://docs.z.ai/devpack/faq

## Sign-in methods

- API key only. The Claude Code page says to create a key on the API Keys page (https://z.ai/manage-apikey/apikey-list) and set it as `ANTHROPIC_AUTH_TOKEN`; no page offers OAuth or a browser login for third-party tools or Claude Code. So Spark Outpost shows the key field without a method toggle.
- The GLM Coding Plan uses the same kind of key and, for Claude Code, the same base URL (`https://api.z.ai/api/anthropic`). Only its OpenAI-protocol URL differs (`/api/coding/paas/v4`), which we don't use. Individual Plan keys come from the same API Keys page; Team Plan members get theirs under Team Coding Plan → My Plan (https://z.ai/manage-apikey/coding-plan/team/my-plan). A plan selector would change nothing we send, so there isn't one; the only visible difference is that the cost estimate overstates Coding Plan usage.

Source: https://docs.z.ai/devpack/tool/claude, https://docs.z.ai/devpack/quick-start

## Pay as you go vs the GLM Coding Plan

- General API (OpenAI protocol): `https://api.z.ai/api/paas/v4`.
- Coding Plan: `https://api.z.ai/api/coding/paas/v4` (OpenAI protocol), `https://api.z.ai/api/anthropic` (Anthropic protocol, used by Claude Code), `https://api.z.ai/api/v1` (Responses).
- Individual keys come from the same API-keys page for both. Team Plan keys are not interchangeable with other Z.ai keys; error 1315 marks keys limited to enterprise coding use.
- A wrong endpoint means the Coding Plan quota isn't used (error 1113).

Source: https://docs.z.ai/devpack/quick-start, https://docs.z.ai/devpack/tool/others, https://docs.z.ai/api-reference/introduction
