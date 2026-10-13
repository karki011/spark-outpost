import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureLines } from './fixtures/terminal-usage/read.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const transcript_path = join('/fixture/projects', 'native-provider-session.jsonl');
const prompt = (prompt_id: string) =>
  f.hook('UserPromptSubmit', { prompt: `Prompt ${prompt_id}`, prompt_id, transcript_path });
const user = (promptId: string) => ({
  type: 'user',
  promptId,
  message: { role: 'user', content: 'x' },
});
const reply = (id: string, output: number, model = 'claude-opus-5-5') => ({
  type: 'assistant',
  message: {
    id,
    model,
    usage: {
      input_tokens: 2,
      output_tokens: output,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 100,
      cache_creation: { ephemeral_1h_input_tokens: 100 },
      output_tokens_details: { thinking_tokens: 3 },
    },
  },
});
const costState = (totalCostUSD: number, sessionId = 'native-provider-session') => ({
  type: 'cost-state',
  sessionId,
  totalCostUSD,
  modelUsage: {
    'claude-opus-5-5': { inputTokens: 500, outputTokens: 90, costUSD: totalCostUSD - 0.001 },
    'claude-haiku-5-5': { inputTokens: 1200, outputTokens: 17, costUSD: 0.001 },
  },
});
const usage = () => f.runtime.usage(f.conversationId);
const runs = async () =>
  (
    await f.t.db.query(
      `SELECT status, used_model, input_tokens, output_tokens, total_tokens, cached_read_tokens,
         cached_write_tokens, thought_tokens, cost_usd::float8 AS cost_usd, cost_source
       FROM runs WHERE conversation_id = $1 ORDER BY created_at`,
      [f.conversationId],
    )
  ).rows;

describe('native terminal usage from the Claude transcript', () => {
  it('stores the tokens and an estimated cost on the turn they belong to', async () => {
    await f.launch();
    await prompt('first');
    const watcher = f.watchers[0]!;
    expect(watcher.from).toBeNull();
    await watcher.lines([user('first'), reply('msg_1', 10), reply('msg_1', 10)]);
    expect(await runs()).toMatchObject([
      { status: 'running', output_tokens: 10, cost_source: 'estimated' },
    ]);
    await watcher.lines([reply('msg_same_turn', 999), user('earlier'), reply('msg_old', 999)]);
    watcher.atFlush.push(user('first'), reply('msg_2', 30));
    watcher.position = 4096;
    await f.hook('Stop', { prompt_id: 'first' });
    expect(await runs()).toEqual([
      {
        status: 'succeeded',
        used_model: 'claude-opus-5-5',
        input_tokens: 6,
        output_tokens: 1039,
        total_tokens: 4345,
        cached_read_tokens: 3000,
        cached_write_tokens: 300,
        thought_tokens: 9,
        cost_usd: 0.023804,
        cost_source: 'estimated',
      },
    ]);
    await prompt('second');
    expect(f.watchers[1]!.from).toBe(4096);
    await f.hook('Stop', { prompt_id: 'second' });
    const turns = (await usage()).turns;
    expect(
      turns.map((turn) => [turn.tokens?.output ?? null, turn.costUsd, turn.costSource]),
    ).toEqual([
      [1039, 0.023804, 'estimated'],
      [null, null, null],
    ]);
  });

  it('leaves the cost unknown when the model has no price, and never fails the turn', async () => {
    await f.launch();
    await prompt('first');
    await f.watchers[0]!.lines([
      'not json',
      { type: 'from-a-later-version', usage: {} },
      reply('msg_1', 5, 'claude-unlisted-9'),
    ]);
    expect(await f.hook('Stop', { prompt_id: 'first' })).toBe(204);
    expect(await runs()).toMatchObject([
      { status: 'succeeded', used_model: 'claude-unlisted-9', output_tokens: 5, cost_usd: null },
    ]);
  });

  it('keeps the last total Claude Code reports for the session, apart from the turn estimates', async () => {
    await f.launch();
    await prompt('first');
    await f.watchers[0]!.lines([reply('msg_1', 10)]);
    await f.hook('Stop', { prompt_id: 'first' });
    expect((await usage()).reported).toBeNull();
    await prompt('second');
    await f.watchers[1]!.lines([
      costState(0.4),
      costState(0.4),
      costState(9, 'another-session'),
      costState(0.43),
    ]);
    await f.hook('Stop', { prompt_id: 'second' });
    const seen = await usage();
    expect(seen.reported).toMatchObject({ costUsd: 0.43, cliSessions: 1 });
    expect(seen.reported!.models.map((model) => [model.model, model.input, model.costUsd])).toEqual(
      [
        ['claude-opus-5-5', 500, 0.429],
        ['claude-haiku-5-5', 1200, 0.001],
      ],
    );
    expect(seen.turns.map((turn) => turn.costUsd)).toEqual([0.001208, null]);
  });

  it('reads the total written at exit once more after the CLI has gone', async () => {
    await f.launch();
    await prompt('first');
    f.watchers[0]!.position = 100;
    await f.hook('Stop', { prompt_id: 'first' });
    f.exits[0]!({ exitCode: 0 });
    await expect.poll(() => f.watchers.length).toBe(2);
    expect(f.watchers[1]!.from).toBe(100);
    await f.watchers[1]!.lines([costState(0.25)]);
    await expect.poll(async () => (await usage()).reported?.costUsd).toBe(0.25);
    expect(f.watchers[1]!.close).toHaveBeenCalledTimes(1);
  });

  it('adds up a real three-turn session below the total the CLI reports for it', async () => {
    const lines = fixtureLines('claude-three-turns.jsonl').map(
      (line) => JSON.parse(line) as unknown,
    );
    const prompts = [
      '51e3e15c-bcec-44e6-832c-788b1fd8795f',
      '18d97d5d-44cc-4b5d-8f06-886a214dfa0a',
      'c9bbceed-c07d-4967-b655-6374d3c07e6e',
    ];
    await f.launch();
    const session_id = 'd5df4f96-ada8-4de6-9318-ec4a23378739';
    const path = join('/fixture/projects', `${session_id}.jsonl`);
    for (const [index, prompt_id] of prompts.entries()) {
      await f.hook('UserPromptSubmit', {
        prompt: 'x',
        prompt_id,
        session_id,
        transcript_path: path,
      });
      await f.watchers[index]!.lines(lines);
      await f.hook('Stop', { prompt_id, session_id });
    }
    const seen = await usage();
    expect(seen.turns.map((turn) => turn.costUsd)).toEqual([0.105045, 0.120584, 0.010651]);
    expect(seen.reported?.costUsd).toBe(0.262432);
  });
});
