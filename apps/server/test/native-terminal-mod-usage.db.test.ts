import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const reply = (id: string, output: number) => ({
  type: 'assistant',
  message: {
    id,
    model: 'claude-opus-5-5',
    usage: {
      input_tokens: 2,
      output_tokens: output,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 100,
      cache_creation: { ephemeral_1h_input_tokens: 100 },
    },
  },
});
const turnStart = (prompt: string, turn = `${prompt}-turn`, agent: string | null = null) => ({
  kind: 'turn_start',
  prompt,
  agent,
  turn,
  at: AT,
});
const turnEnd = (prompt: string, aborted = false, turn = `${prompt}-turn`) => ({
  kind: 'turn_end',
  prompt,
  agent: null,
  turn,
  at: AT + 4000,
  durationMs: 4000,
  aborted,
});
const request = (
  prompt: string,
  index: number,
  output: number,
  extra: { agent?: string; turn?: string; costUsd?: number | null } = {},
) => ({
  kind: 'request',
  prompt,
  agent: extra.agent ?? null,
  turn: extra.turn ?? `${prompt}-turn`,
  index,
  model: 'claude-opus-5-5',
  input: 3,
  output,
  cacheRead: 900,
  cacheWrite: 100,
  costUsd: extra.costUsd === undefined ? 0.01 : extra.costUsd,
});
const tool = (prompt: string, phase: 'start' | 'end', at = AT + 1000) => ({
  kind: 'tool',
  prompt,
  agent: null,
  id: 'toolu_1',
  name: 'Bash',
  phase,
  failed: false,
  at,
});
const runs = async () =>
  (
    await f.t.db.query(
      `SELECT status, output_tokens, cached_write_tokens, cost_usd::float8 AS cost_usd, cost_source
       FROM runs WHERE conversation_id = $1 ORDER BY created_at`,
      [f.conversationId],
    )
  ).rows;
const usage = () => f.runtime.usage(f.conversationId);

describe('Terminal usage from the Spark mod', () => {
  it('records each request, step and turn once, however often the mod sends them', async () => {
    await f.launch();
    await prompt('first');
    const facts = [
      turnStart('first'),
      tool('first', 'start'),
      request('first', 0, 40),
      tool('first', 'end', AT + 2000),
      request('first', 1, 60, { agent: 'agent-a', turn: 'sub-turn' }),
      turnEnd('first'),
    ];
    expect(await f.modFacts(facts)).toBe(204);
    expect(await f.modFacts(facts)).toBe(204);
    await f.hook('PreToolUse', { prompt_id: 'first', tool_name: 'Bash', tool_use_id: 'toolu_1' });
    await f.watchers[0]!.lines([user('first'), reply('msg_1', 999)]);
    await f.hook('Stop', { prompt_id: 'first' });
    expect(await runs()).toEqual([
      {
        status: 'succeeded',
        output_tokens: 100,
        cached_write_tokens: 200,
        cost_usd: 0.02,
        cost_source: 'reported',
      },
    ]);
    const [turn] = (await usage()).turns;
    expect(turn).toMatchObject({ durationMs: 4000, tokens: { input: 6, cachedRead: 1800 } });
    expect(turn!.steps).toEqual([
      {
        id: 'toolu_1',
        name: 'Bash',
        agentId: null,
        startedAt: new Date(AT + 1000).toISOString(),
        endedAt: new Date(AT + 2000).toISOString(),
        failed: false,
      },
    ]);
  });

  it('estimates the cost from the tokens when the mod could not read Claude Code’s cost', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([turnStart('first'), request('first', 0, 40, { costUsd: null })]);
    expect(await runs()).toMatchObject([{ output_tokens: 40, cost_source: 'estimated' }]);
  });

  it('counts the session file for turns the mod did not see, and never both', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([turnStart('first'), request('first', 0, 40)]);
    await f.watchers[0]!.lines([user('first'), reply('msg_1', 999)]);
    await f.hook('Stop', { prompt_id: 'first' });
    await prompt('second');
    await f.watchers[1]!.lines([user('second'), reply('msg_2', 7)]);
    await f.hook('Stop', { prompt_id: 'second' });
    expect((await runs()).map((run) => [run.output_tokens, run.cost_source])).toEqual([
      [40, 'reported'],
      [7, 'estimated'],
    ]);
  });

  it('replaces what the session file counted once the mod’s facts for the turn arrive', async () => {
    await f.launch();
    await prompt('first');
    await f.watchers[0]!.lines([user('first'), reply('msg_1', 999)]);
    expect(await runs()).toMatchObject([{ output_tokens: 999 }]);
    await f.modFacts([turnStart('first'), request('first', 0, 40)]);
    await f.watchers[0]!.lines([reply('msg_2', 5)]);
    await f.hook('Stop', { prompt_id: 'first' });
    expect(await runs()).toMatchObject([{ output_tokens: 40, cost_usd: 0.01 }]);
  });

  it('leaves the session file in charge when the mod never saw the turn start', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([request('first', 0, 40)]);
    await f.watchers[0]!.lines([user('first'), reply('msg_1', 12)]);
    await f.hook('Stop', { prompt_id: 'first' });
    expect(await runs()).toMatchObject([{ output_tokens: 12, cost_source: 'estimated' }]);
  });

  it('drops facts for a prompt Spark has no turn for', async () => {
    await f.launch();
    await prompt('first');
    expect(await f.modFacts([turnStart('unknown'), request('unknown', 0, 40)])).toBe(204);
    const counted = await f.t.db.query('SELECT 1 FROM native_terminal_requests');
    expect(counted.rowCount).toBe(0);
  });

  it('ends the turn as stopped when the mod reports it was interrupted', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([turnStart('first'), turnEnd('first', true)]);
    await expect.poll(async () => (await runs())[0]?.status).toBe('cancelled');
  });

  it('turns down a batch that is not one, and anything for a Codex session', async () => {
    await f.launch();
    expect(await f.modFacts('nope' as unknown as unknown[])).toBe(400);
    await f.cleanup();
    f = await nativeRuntimeFixture({ provider: 'codex' });
    await f.launch();
    expect(await f.modFacts([])).toBe(400);
  });
});

describe('Terminal usage from the Spark mod for a prompt Claude Code sent itself', () => {
  it('moves the mod’s facts to the turn that owns the prompt when Spark takes the turn back', async () => {
    await f.launch();
    await prompt('first');
    await f.modFacts([turnStart('first'), request('first', 0, 40)]);
    await f.watchers[0]!.lines([user('first')]);
    await f.hook('Stop', { prompt_id: 'first' });
    await prompt('handback');
    await f.modFacts([turnStart('handback'), request('handback', 0, 9)]);
    expect((await usage()).turns).toHaveLength(2);
    await f.watchers[1]!.lines([
      { type: 'user', promptId: 'handback', origin: { kind: 'task-notification' } },
    ]);
    await expect.poll(async () => (await usage()).turns.length).toBe(1);
    await expect.poll(async () => (await runs())[0]?.output_tokens).toBe(49);
    expect(await runs()).toMatchObject([{ cost_usd: 0.02, cost_source: 'reported' }]);
  });
});
