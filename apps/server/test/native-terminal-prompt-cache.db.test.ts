import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOD_SIDE_INDEX } from '../src/terminal/native-mod-telemetry-script.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const transcript_path = join('/fixture/projects', 'native-provider-session.jsonl');
const AT = 1_792_000_000_000;
const prompt = (prompt_id: string) =>
  f.hook('UserPromptSubmit', { prompt: `Prompt ${prompt_id}`, prompt_id, transcript_path });
const user = (promptId: string) => ({
  type: 'user',
  promptId,
  origin: { kind: 'human' },
  message: { role: 'user', content: 'x' },
});
const reply = (id: string, written: { short: number; long: number }) => ({
  type: 'assistant',
  message: {
    id,
    model: 'claude-opus-5-5',
    usage: {
      input_tokens: 2,
      output_tokens: 10,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: written.short + written.long,
      cache_creation: {
        ephemeral_5m_input_tokens: written.short,
        ephemeral_1h_input_tokens: written.long,
      },
    },
  },
});
const turnStart = (prompt: string, agent: string | null = null, turn = `${prompt}-turn`) => ({
  kind: 'turn_start',
  prompt,
  agent,
  turn,
  at: AT,
});
const turnEnd = (prompt: string, agent: string | null = null, turn = `${prompt}-turn`) => ({
  kind: 'turn_end',
  prompt,
  agent,
  turn,
  at: AT + 4000,
  durationMs: 4000,
  aborted: false,
});
const request = (
  prompt: string,
  index: number,
  extra: {
    agent?: string;
    turn?: string;
    write?: number;
    read?: number;
    costUsd?: number | null;
    at?: number;
  } = {},
) => ({
  kind: 'request',
  prompt,
  agent: extra.agent ?? null,
  turn: extra.turn ?? `${prompt}-turn`,
  index,
  model: 'claude-opus-5-5',
  input: 3,
  output: 40,
  cacheRead: extra.read ?? 900,
  cacheWrite: extra.write ?? 100,
  costUsd: extra.costUsd === undefined ? 0.01 : extra.costUsd,
  ...(extra.at === undefined ? {} : { at: extra.at }),
});
const cache = async () => (await f.runtime.usage(f.conversationId)).promptCache!;
const runCost = async () =>
  (
    await f.t.db.query(
      `SELECT cost_usd::float8 AS cost_usd, cost_source FROM runs
       WHERE conversation_id = $1 ORDER BY created_at`,
      [f.conversationId],
    )
  ).rows;

describe('a Terminal session’s prompt cache from the Spark mod', () => {
  it('times the countdown from the main thread’s last request, not a sub-agent’s or a side row', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([
      turnStart('first'),
      request('first', 0, { at: AT + 1000, write: 5000 }),
      request('first', 1, { at: AT + 2000 }),
      turnStart('first', 'agent-a', 'sub-turn'),
      request('first', 0, { agent: 'agent-a', turn: 'sub-turn', at: AT + 9000 }),
      request('first', MOD_SIDE_INDEX, { at: AT + 9500, read: 0, write: 0 }),
    ]);
    await f.watchers[0]!.lines([user('first'), reply('msg_1', { short: 0, long: 5000 })]);
    const shown = await cache();
    expect(shown.last).toMatchObject({
      at: new Date(AT + 2000).toISOString(),
      contextTokens: 3 + 40 + 900 + 100,
      ttlSeconds: 3600,
      expired: null,
    });
    expect(shown.subagentsWorking).toBe(1);
    await f.modFacts([turnEnd('first', 'agent-a', 'sub-turn')]);
    expect((await cache()).subagentsWorking).toBe(0);
  });

  it('notes a turn whose first request re-wrote the previous context', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([
      turnStart('first'),
      request('first', 0, { read: 180_000 }),
      turnEnd('first'),
    ]);
    await f.hook('Stop', { prompt_id: 'first' });
    await prompt('second');
    await f.modFacts([turnStart('second'), request('second', 0, { read: 0, write: 181_000 })]);
    const { turns } = await f.runtime.usage(f.conversationId);
    const shown = await cache();
    expect(Object.keys(shown.rebuilds)).toEqual([turns[1]!.runId]);
    expect(shown.rebuilds[turns[1]!.runId]!.tokens).toBe(181_000);
  });

  it('shows Claude Code’s verdict after a resume until the next request', async () => {
    await f.launch();
    expect(
      await f.modFacts([
        {
          kind: 'cache_resume',
          at: AT,
          secondsSince: 4000,
          contextTokens: 330_000,
          likelyExpired: true,
          estimatedWriteUsd: 6.6,
        },
      ]),
    ).toBe(204);
    expect((await cache()).last).toEqual({
      at: new Date(AT - 4_000_000).toISOString(),
      contextTokens: 330_000,
      ttlSeconds: null,
      rewriteUsd: 6.6,
      expired: true,
      estimateBy: 'claude-code',
    });
    await prompt('first');
    await f.modFacts([turnStart('first'), request('first', 0, { at: AT + 1000 })]);
    expect((await cache()).last).toMatchObject({ expired: null, estimateBy: 'spark' });
  });

  it('takes the request time from when Spark heard of it when an older mod sends none', async () => {
    await f.launch();
    await prompt('first');
    const before = Date.now();
    await f.modFacts([turnStart('first'), request('first', 0)]);
    const at = Date.parse((await cache()).last!.at);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('a Terminal turn’s estimated cost when Claude Code’s cost is missing', () => {
  it('prices the 1-hour writes the session file shows at the 1-hour rate', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([turnStart('first'), request('first', 0, { write: 1000, costUsd: null })]);
    const atShortRate = (await runCost())[0]!.cost_usd as number;
    await f.watchers[0]!.lines([user('first'), reply('msg_1', { short: 0, long: 1000 })]);
    const [run] = await runCost();
    expect(run!.cost_source).toBe('estimated');
    expect(run!.cost_usd - atShortRate).toBeCloseTo((1000 * (8 - 5)) / 1e6, 6);
  });

  it('keeps the 5-minute rate for writes the session file shows in the 5-minute bucket', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([turnStart('first'), request('first', 0, { write: 1000, costUsd: null })]);
    const before = (await runCost())[0]!.cost_usd;
    await f.watchers[0]!.lines([user('first'), reply('msg_1', { short: 1000, long: 0 })]);
    expect((await runCost())[0]!.cost_usd).toBe(before);
  });
});
