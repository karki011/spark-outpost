import { afterEach, describe, expect, it } from 'vitest';
import {
  FACT_AT,
  fromEngine,
  startSparkMod,
  type SparkModHarness,
} from '../../test/spark-mod-engine.ts';
import { MOD_SEND_BYTES, MOD_SEND_MAX } from './native-mod-telemetry-script.ts';

let mod: SparkModHarness;

afterEach(async () => {
  await mod.cleanup();
});

const usage = {
  input_tokens: 3,
  output_tokens: 40,
  cache_read_input_tokens: 900,
  cache_creation_input_tokens: 100,
  model: 'claude-opus-5-5',
};
const bash = { tool: 'Bash', tool_use_id: 'toolu_1', command: 'cat .env', description: 'x' };

async function prompted(promptId = 'prompt-1') {
  await mod.hook('classic.UserPromptSubmit')(mod.engine, { prompt_id: promptId }, fromEngine());
}

async function oneTurn() {
  await prompted();
  await mod.hook('turn.start')(
    mod.engine,
    { turnId: 'turn-1', text: 'secret prompt' },
    fromEngine(),
  );
  const ran = async () => ({ isError: true, text: 'tool-printed-this' });
  await mod.hook('tool.call')(mod.engine, bash, fromEngine(ran));
  mod.spend(0.25);
  await mod.step({ turnId: 'turn-1', index: 0 }, usage, 'secret reply');
  await mod.hook('turn.complete')(
    mod.engine,
    { turnId: 'turn-1', durationMs: 1234.6, isAborted: false, answer: 'secret reply' },
    fromEngine(),
  );
}

async function pollOnce(status = 204) {
  mod.inbox({ messages: [], notices: [], status: null });
  mod.answer(status);
  await mod.tick();
}

const facts = (index = 1) => mod.sentItems(index).items;
const toolFact = { kind: 'tool', prompt: 'prompt-1', agent: null, id: 'toolu_1', name: 'Bash' };

describe('the Spark mod’s turn facts', () => {
  it('sends Spark only names, times, token counts and cost, never commands, prompts or replies', async () => {
    mod = await startSparkMod();
    await oneTurn();
    await pollOnce();
    expect(mod.requests[1]!.url).toBe('http://127.0.0.1:4100/mod/telemetry');
    expect(mod.requests[1]!.init.headers).toMatchObject({ Authorization: 'Bearer first-token' });
    expect(facts()).toEqual([
      { kind: 'turn_start', prompt: 'prompt-1', agent: null, turn: 'turn-1', at: FACT_AT },
      { ...toolFact, phase: 'start', failed: false, at: FACT_AT },
      { ...toolFact, phase: 'end', failed: true, at: FACT_AT },
      {
        kind: 'request',
        prompt: 'prompt-1',
        agent: null,
        turn: 'turn-1',
        index: 0,
        model: 'claude-opus-5-5',
        input: 3,
        output: 40,
        cacheRead: 900,
        cacheWrite: 100,
        costUsd: 0.25,
      },
      {
        kind: 'turn_end',
        prompt: 'prompt-1',
        agent: null,
        turn: 'turn-1',
        at: FACT_AT,
        durationMs: 1235,
        aborted: false,
      },
    ]);
    expect(String(mod.requests[1]!.init.body)).not.toMatch(
      /cat \.env|secret|description|tool-printed-this/,
    );
  });

  it('keeps the facts for the next poll when Spark is away or the token is stale', async () => {
    mod = await startSparkMod();
    await oneTurn();
    await pollOnce(401);
    await pollOnce(204);
    expect(facts(3)).toEqual(facts(1));
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    expect(mod.requests).toHaveLength(5);
  });

  it('sends the facts in batches of a bounded count', async () => {
    mod = await startSparkMod();
    await prompted();
    for (let index = 0; index < 225; index++)
      await mod.hook('tool.call')(
        mod.engine,
        { tool: 'Read', tool_use_id: `toolu_${index}` },
        async () => ({}),
      );
    mod.inbox({ messages: [], notices: [], status: null });
    for (let round = 0; round < 3; round++) mod.answer(204);
    await mod.tick();
    expect([1, 2, 3].map((index) => facts(index).length)).toEqual([
      MOD_SEND_MAX,
      MOD_SEND_MAX,
      450 - 2 * MOD_SEND_MAX,
    ]);
  });

  it('drops a batch Spark turned down, so one bad item never blocks the rest', async () => {
    mod = await startSparkMod();
    await oneTurn();
    await pollOnce(400);
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    expect(mod.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/mod/inbox',
      '/mod/telemetry',
      '/mod/inbox',
    ]);
  });

  it('attributes a subagent to the turn that started it and skips facts other mods raised', async () => {
    mod = await startSparkMod();
    const pluginCall = Object.assign((e: unknown) => e, {
      origin: { plugin: 'other-mod', tier: 'user' },
    });
    await prompted('prompt-1');
    await mod.hook('turn.start')(mod.engine, { turnId: 'sub-1', agentId: 'agent-a' }, fromEngine());
    await prompted('prompt-2');
    await mod.hook('turn.start')(mod.engine, { turnId: 'mine', agentId: 'agent-b' }, pluginCall);
    await mod.hook('turn.complete')(
      mod.engine,
      { turnId: 'sub-1', agentId: 'agent-a', durationMs: 5, isAborted: true },
      fromEngine(),
    );
    await pollOnce();
    expect(facts().map((item) => [item.kind, item.prompt, item.agent])).toEqual([
      ['turn_start', 'prompt-1', 'agent-a'],
      ['turn_end', 'prompt-1', 'agent-a'],
    ]);
  });
});

describe('the Spark mod when sends fail or requests overlap', () => {
  it('keeps the facts when the request to Spark fails outright, and sends them next time', async () => {
    mod = await startSparkMod();
    await oneTurn();
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    expect(mod.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/mod/inbox',
      '/mod/telemetry',
    ]);
    await pollOnce();
    expect(facts(3)).toEqual(facts(1));
  });
});

describe('the Spark mod when only its turn facts are refused', () => {
  it('keeps the status line and the facts while the telemetry request fails', async () => {
    mod = await startSparkMod();
    await oneTurn();
    mod.inbox({ messages: [], notices: [], status: 'Spark · phone connected' });
    mod.answer(500);
    await mod.tick();
    expect(mod.band()).toMatchObject({ children: ['Spark · phone connected'] });
    await mod.writeConfig('http://127.0.0.1:4200/events', 'second-token');
    mod.inbox({ messages: [], notices: [], status: 'Spark · phone connected' });
    mod.answer(204);
    await mod.tick();
    expect(mod.band()).toMatchObject({ children: ['Spark · phone connected'] });
    expect(mod.requests[3]!.url).toBe('http://127.0.0.1:4100/mod/telemetry');
    expect(facts(3)).toEqual(facts(1));
  });

  it('reads its config again after a stale token on the facts request', async () => {
    mod = await startSparkMod();
    await oneTurn();
    mod.inbox({ messages: [], notices: [], status: 'Spark · phone connected' });
    mod.answer(401);
    await mod.tick();
    expect(mod.band()).toMatchObject({ children: ['Spark · phone connected'] });
    await mod.writeConfig('http://127.0.0.1:4200/events', 'second-token');
    await pollOnce();
    expect(mod.requests[2]!.url).toBe('http://127.0.0.1:4200/mod/inbox');
    expect(facts(3)).toEqual(facts(1));
  });
});

describe('the Spark mod while Terminal sessions are recorded like chats', () => {
  it('adds the tool’s input and output, whether Claude asked first, and the reply', async () => {
    mod = await startSparkMod({ record: true });
    await prompted();
    await mod.hook('turn.start')(mod.engine, { turnId: 'turn-1' }, fromEngine());
    expect(mod.requests).toHaveLength(1);
    const ran = async () => {
      await mod.hook('classic.PermissionRequest')(
        mod.engine,
        { tool_name: 'Bash', tool_input: { description: 'x', command: 'cat .env' } },
        fromEngine(),
      );
      return { text: 'printed' };
    };
    await mod.hook('tool.call')(mod.engine, bash, fromEngine(ran));
    await mod.step({ turnId: 'turn-1', index: 0 }, usage, 'All done.');
    await pollOnce();
    expect(facts(2).filter((item) => item.kind !== 'request')).toEqual([
      {
        kind: 'turn_start',
        prompt: 'prompt-1',
        agent: null,
        turn: 'turn-1',
        at: FACT_AT,
        record: true,
      },
      {
        ...toolFact,
        phase: 'start',
        failed: false,
        at: FACT_AT,
        input: { command: 'cat .env', description: 'x' },
      },
      { ...toolFact, phase: 'end', failed: false, at: FACT_AT, output: 'printed', asked: true },
      {
        kind: 'reply',
        prompt: 'prompt-1',
        agent: null,
        turn: 'turn-1',
        index: 0,
        text: 'All done.',
      },
    ]);
  });

  it('stops adding them when Spark says recording is off', async () => {
    mod = await startSparkMod({ record: true });
    mod.inbox({ messages: [], notices: [], status: null, record: false });
    await mod.tick();
    await prompted();
    await mod.hook('tool.call')(
      mod.engine,
      bash,
      fromEngine(async () => ({ text: 'x' })),
    );
    await pollOnce();
    expect(facts(2).map((item) => Object.keys(item).sort())).toEqual([
      ['agent', 'at', 'failed', 'id', 'kind', 'name', 'phase', 'prompt'],
      ['agent', 'at', 'failed', 'id', 'kind', 'name', 'phase', 'prompt'],
    ]);
  });

  it('hands Spark the turn’s facts before Claude’s own Stop hooks run', async () => {
    mod = await startSparkMod({ record: true });
    await prompted();
    await mod.hook('tool.call')(
      mod.engine,
      bash,
      fromEngine(async () => ({ text: 'x' })),
    );
    mod.answer(204);
    let sentBeforeStop = 0;
    await mod.hook('classic.Stop')(mod.engine, {}, () => {
      sentBeforeStop = mod.requests.length;
    });
    expect(sentBeforeStop).toBe(1);
    expect(facts(0)).toHaveLength(2);
  });

  it('sizes requests in UTF-8 bytes, so wide characters never pass the hook host’s limit', async () => {
    mod = await startSparkMod({ record: true });
    await prompted();
    for (let index = 0; index < 20; index++)
      await mod.hook('tool.call')(
        mod.engine,
        {
          tool: 'Write',
          tool_use_id: `toolu_${index}`,
          file_path: '/p',
          content: '漢'.repeat(6000),
        },
        async () => ({ text: '😀'.repeat(3000) }),
      );
    mod.inbox({ messages: [], notices: [], status: null });
    for (let round = 0; round < 10; round++) mod.answer(204);
    await mod.tick();
    const bytes = mod.requests
      .slice(1)
      .map((request) => Buffer.byteLength(String(request.init.body), 'utf8'));
    expect(bytes.length).toBeGreaterThan(1);
    expect(Math.max(...bytes)).toBeLessThanOrEqual(MOD_SEND_BYTES + 20);
  });

  it('sends facts one at a time after a too-big batch and drops one still too big', async () => {
    mod = await startSparkMod({ record: true });
    await prompted();
    await mod.hook('tool.call')(
      mod.engine,
      bash,
      fromEngine(async () => ({ text: 'x' })),
    );
    mod.inbox({ messages: [], notices: [], status: null });
    mod.answer(413);
    await mod.tick();
    mod.inbox({ messages: [], notices: [], status: null });
    mod.answer(413);
    mod.answer(204);
    await mod.tick();
    expect(mod.requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/mod/inbox',
      '/mod/telemetry',
      '/mod/inbox',
      '/mod/telemetry',
      '/mod/telemetry',
    ]);
    expect([facts(3), facts(4)]).toEqual([[facts(1)[0]], [facts(1)[1]]]);
  });

  it('keeps each request under its size cap', async () => {
    mod = await startSparkMod({ record: true });
    await prompted();
    for (let index = 0; index < 60; index++)
      await mod.hook('tool.call')(
        mod.engine,
        {
          tool: 'Write',
          tool_use_id: `toolu_${index}`,
          file_path: '/p',
          content: 'y'.repeat(9000),
        },
        async () => ({ text: 'z'.repeat(9000) }),
      );
    mod.inbox({ messages: [], notices: [], status: null });
    for (let round = 0; round < 10; round++) mod.answer(204);
    await mod.tick();
    const sizes = mod.requests.slice(1).map((request) => String(request.init.body).length);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MOD_SEND_BYTES + 20);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeGreaterThan(60 * 18000);
  });
});
