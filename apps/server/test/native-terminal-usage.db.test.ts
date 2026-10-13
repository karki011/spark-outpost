import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
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
    expect(watcher.from).toBe(0);
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
    expect((await usage()).reported).toEqual([]);
    await prompt('second');
    await f.watchers[1]!.lines([
      costState(0.4),
      costState(0.4),
      costState(9, 'another-session'),
      costState(0.43),
    ]);
    await f.hook('Stop', { prompt_id: 'second' });
    const seen = await usage();
    expect(seen.reported).toMatchObject([
      { nativeSessionId: 'native-provider-session', costUsd: 0.43 },
    ]);
    expect(
      seen.reported[0]!.models.map((model) => [model.model, model.input, model.costUsd]),
    ).toEqual([
      ['claude-opus-5-5', 500, 0.429],
      ['claude-haiku-5-5', 1200, 0.001],
    ]);
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
    await expect.poll(async () => (await usage()).reported[0]?.costUsd).toBe(0.25);
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
    expect(seen.reported.map((total) => total.costUsd)).toEqual([0.262432]);
  });

  it('adds a Claude sub-agent file named by its hook to the turn that is open', async () => {
    await f.launch();
    await prompt('5786d33b-f704-4717-a7ff-7351229f80a5');
    await f.watchers[0]!.lines([reply('msg_1', 10)]);
    await f.hook('PreToolUse', {
      prompt_id: '5786d33b-f704-4717-a7ff-7351229f80a5',
      transcript_path,
      tool_use_id: 'toolu_child',
      tool_name: 'Bash',
      agent_id: 'aec39d782762e820d',
    });
    expect(f.watchers.map((watcher) => [watcher.path, watcher.from])).toEqual([
      [transcript_path, 0],
      ['/fixture/projects/native-provider-session/subagents/agent-aec39d782762e820d.jsonl', 0],
    ]);
    await f.watchers[1]!.lines(
      fixtureLines('claude-subagent.jsonl').map((line) => JSON.parse(line) as unknown),
    );
    await f.hook('Stop', { prompt_id: '5786d33b-f704-4717-a7ff-7351229f80a5' });
    expect(f.watchers[1]!.close).not.toHaveBeenCalled();
    expect(await runs()).toMatchObject([
      { input_tokens: 6, output_tokens: 50, cached_read_tokens: 29548, cached_write_tokens: 31059 },
    ]);
    expect((await usage()).turns[0]!.steps).toMatchObject([
      { name: 'Bash', agentId: 'aec39d782762e820d' },
    ]);
  });
});

describe('native terminal usage that arrives late', () => {
  const PARENT = '5786d33b-f704-4717-a7ff-7351229f80a5';
  const AGENT = 'aec39d782762e820d';
  const parsed = (name: string) => fixtureLines(name).map((line) => JSON.parse(line) as unknown);
  const agentTool = (name: string, tool_name: string, tool_use_id: string) =>
    f.hook(name, { prompt_id: PARENT, transcript_path, tool_name, tool_use_id, agent_id: AGENT });

  it('files a background sub-agent that finishes after Stop under the turn that started it', async () => {
    await f.launch();
    await prompt('3dc9909e-15d8-4026-9e0f-50c6dd227bc3');
    await f.hook('Stop', { prompt_id: '3dc9909e-15d8-4026-9e0f-50c6dd227bc3' });
    await prompt(PARENT);
    f.watchers[1]!.atFlush.push(...parsed('claude-resume-interrupt-subagent.jsonl').slice(0, 50));
    await f.hook('Stop', { prompt_id: PARENT });
    expect((await runs())[1]).toMatchObject({ status: 'succeeded', cost_usd: 0.032159 });
    expect(await agentTool('PreToolUse', 'Bash', 'toolu_child_1')).toBe(204);
    expect(await agentTool('PostToolUse', 'Bash', 'toolu_child_1')).toBe(204);
    const side = f.watchers[2]!;
    expect(side).toMatchObject({ path: expect.stringContaining(`agent-${AGENT}.jsonl`), from: 0 });
    side.atFlush.push(...parsed('claude-subagent.jsonl'));
    expect(await agentTool('PreToolUse', 'SubagentHandback', 'toolu_child_2')).toBe(204);
    expect(await agentTool('PostToolUse', 'SubagentHandback', 'toolu_child_2')).toBe(204);
    expect(side.close).toHaveBeenCalledTimes(1);
    const seen = await usage();
    expect(seen.turns.map((turn) => [turn.status, turn.costUsd, turn.steps.length])).toEqual([
      ['succeeded', 0.150669, 0],
      ['succeeded', 0.19348, 2],
    ]);
    expect(seen.turns[1]!.tokens).toMatchObject({ input: 8, output: 429, cachedWrite: 31875 });
    expect(seen.turns[1]!.steps.every((step) => step.agentId === AGENT)).toBe(true);
    expect((await nativeTerminalRow(f.t.db, f.conversationId))!.state).toBe('ready');
  });

  it('drops a late sub-agent call that no turn of this session started', async () => {
    await f.launch();
    await prompt('first');
    await f.hook('Stop', { prompt_id: 'first' });
    expect(await agentTool('PreToolUse', 'Bash', 'toolu_stray')).toBe(204);
    expect((await usage()).turns[0]!.steps).toEqual([]);
  });

  it('resumes reading where it stopped, counts nothing twice and picks up a total written meanwhile', async () => {
    await f.launch();
    await prompt('first');
    await f.watchers[0]!.lines([user('first'), reply('msg_1', 10)]);
    f.watchers[0]!.position = 500;
    await f.hook('Stop', { prompt_id: 'first' });
    f.exits[0]!({ exitCode: 0 });
    await expect.poll(() => f.watchers.length).toBe(2);
    await expect
      .poll(async () => (await nativeTerminalRow(f.t.db, f.conversationId))!.usage_offset)
      .toBe('500');
    await f.runtime.launch(f.conversationId, { resume: true });
    await prompt('second');
    const resumed = f.watchers.at(-1)!;
    expect(resumed.from).toBe(500);
    await resumed.lines([
      reply('msg_1', 10),
      costState(0.2),
      user('first'),
      reply('msg_1', 10),
      user('second'),
      reply('msg_2', 20),
    ]);
    await f.hook('Stop', { prompt_id: 'second' });
    const seen = await usage();
    expect(seen.turns.map((turn) => turn.tokens?.output ?? null)).toEqual([10, 20]);
    expect(seen.reported.map((total) => total.costUsd)).toEqual([0.2]);
  });

  it('reads the session file once more after Stop has ended the process', async () => {
    await f.launch();
    await prompt('first');
    f.watchers[0]!.position = 100;
    await f.runtime.stop(f.conversationId);
    expect(f.watchers).toHaveLength(1);
    f.exits[0]!({ exitCode: 129 });
    await expect.poll(() => f.watchers.length).toBe(2);
    expect(f.watchers[1]!.from).toBe(100);
    await f.watchers[1]!.lines([costState(0.31)]);
    await expect.poll(async () => (await usage()).reported[0]?.costUsd).toBe(0.31);
    expect((await runs())[0]).toMatchObject({ status: 'cancelled' });
  });
});

describe('native terminal prompts the user did not type', () => {
  const PARENT = 'e7800f6f-7aa4-4ea1-a883-19ba220a2bf7';
  const HANDBACK = '4d9e891c-2f4e-42b7-a689-c77d4d513d6d';
  const AGENT = 'ad1f5f51c14fb7c05';
  const parsed = (name: string) => fixtureLines(name).map((line) => JSON.parse(line) as unknown);
  const main = () => parsed('claude-pass-resume-handback.jsonl');
  const agentTool = (name: string, tool_name: string, tool_use_id: string) =>
    f.hook(name, { prompt_id: PARENT, transcript_path, tool_name, tool_use_id, agent_id: AGENT });
  const startSubagent = async () => {
    await f.launch();
    await prompt(PARENT);
    f.watchers[0]!.atFlush.push(...main().slice(51, 59));
    await f.hook('Stop', { prompt_id: PARENT });
    await agentTool('PreToolUse', 'Bash', 'toolu_child_1');
    await agentTool('PostToolUse', 'Bash', 'toolu_child_1');
  };

  it('opens no turn for a sub-agent handback and counts its reply on the turn that started the sub-agent', async () => {
    await startSubagent();
    const side = f.watchers.at(-1)!;
    side.atFlush.push(...parsed('claude-pass-subagent.jsonl'));
    await agentTool('PostToolUse', 'SubagentHandback', 'toolu_child_2');
    expect(
      await f.hook('UserPromptSubmit', {
        prompt: 'handback',
        prompt_id: HANDBACK,
        transcript_path,
      }),
    ).toBe(204);
    expect(await f.hook('Stop', { prompt_id: HANDBACK })).toBe(204);
    expect((await usage()).turns).toHaveLength(1);
    expect(await runs()).toMatchObject([{ status: 'succeeded' }]);
    await prompt('typed-next');
    await f.watchers.at(-1)!.lines(main().slice(59, 67));
    const seen = await usage();
    expect(seen.turns).toHaveLength(2);
    expect(seen.turns[0]!.tokens).toMatchObject({ output: 339 + 32 + 34 + 16 + 24 });
    expect(seen.turns[1]!.tokens).toBeNull();
  });

  it('still opens a turn for a prompt the user types while a sub-agent is running', async () => {
    await startSubagent();
    const typed = { prompt: 'Typed meanwhile', prompt_id: 'typed-1', transcript_path };
    expect(await f.hook('UserPromptSubmit', typed)).toBe(204);
    f.watchers.at(-1)!.atFlush.push({
      type: 'user',
      promptId: 'typed-1',
      origin: { kind: 'human' },
      promptSource: 'typed',
      message: { role: 'user', content: 'x' },
    });
    await f.hook('PreToolUse', { prompt_id: 'typed-1', tool_use_id: 'toolu_t', tool_name: 'Bash' });
    const seen = await usage();
    expect(seen.turns.map((turn) => [turn.status, turn.steps.length])).toEqual([
      ['succeeded', 1],
      ['running', 1],
    ]);
  });

  it('opens the turn at its next event when the file never says who sent the prompt', async () => {
    await startSubagent();
    await f.hook('UserPromptSubmit', { prompt: 'Unmarked', prompt_id: 'typed-2', transcript_path });
    await f.hook('Stop', { prompt_id: 'typed-2' });
    expect((await runs()).map((run) => run.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('holds usage read before the prompt hook arrived and files it when the turn exists', async () => {
    await f.launch();
    await f.hook('SessionStart', { transcript_path });
    await f.watchers[0]!.lines([user('first'), reply('msg_early', 12)]);
    await prompt('first');
    await f.hook('Stop', { prompt_id: 'first' });
    expect((await usage()).turns.map((turn) => turn.tokens?.output ?? null)).toEqual([12]);
  });
});

describe('native terminal usage from the Codex rollout file', () => {
  const ROOT = '01a132f2-3c62-7571-81e1-82c276843d89';
  const CHILD = '01a132f3-4263-77c3-a2be-67e299075490';
  const TURN = '01a132f3-37c3-77c0-8dce-ffbe841b6436';
  const rollout = `/fixture/sessions/rollout-2026-10-12T21-48-18-${ROOT}.jsonl`;
  const childRollout = `/fixture/sessions/rollout-2026-10-12T21-49-25-${CHILD}.jsonl`;
  const parsed = (name: string) => fixtureLines(name).map((line) => JSON.parse(line) as unknown);

  it('stores the turn total with the model the hook names, and a sub-agent thread under its parent turn', async () => {
    await f.cleanup();
    f = await nativeRuntimeFixture({ provider: 'codex' });
    await f.launch();
    const codex = { session_id: ROOT, permission_mode: 'default', model: 'gpt-5.6-sol' };
    await f.hook('UserPromptSubmit', {
      ...codex,
      prompt: 'x',
      turn_id: TURN,
      transcript_path: rollout,
    });
    const tokenRecords = parsed('codex-rollout.jsonl').filter(
      (record) => (record as { type: string }).type === 'token_usage_record',
    );
    await f.watchers[0]!.lines(tokenRecords);
    const child = {
      ...codex,
      turn_id: '01a132f3-435e-7140-a118-95cb75eaebd4',
      agent_id: CHILD,
      transcript_path: childRollout,
      tool_use_id: 'exec-1',
      tool_name: 'Bash',
    };
    expect(await f.hook('PreToolUse', child)).toBe(204);
    expect(await f.hook('PostToolUse', child)).toBe(204);
    expect(f.watchers[1]).toMatchObject({ path: childRollout, from: 0 });
    await f.watchers[1]!.lines(parsed('codex-subagent-rollout.jsonl'));
    await f.hook('Stop', { ...codex, turn_id: TURN });
    expect(await runs()).toEqual([
      {
        status: 'succeeded',
        used_model: 'gpt-5.6-sol',
        input_tokens: 52932 + 35399,
        output_tokens: 193 + 218,
        total_tokens: 53125 + 35617,
        cached_read_tokens: 51712 + 25088,
        cached_write_tokens: 0,
        thought_tokens: 42 + 43,
        cost_usd: 0.085064,
        cost_source: 'estimated',
      },
    ]);
    const seen = await usage();
    expect(seen.reported).toEqual([]);
    expect(seen.turns[0]!.steps).toMatchObject([
      { id: 'exec-1', name: 'Bash', agentId: CHILD, endedAt: expect.any(String) },
    ]);
  });
});
