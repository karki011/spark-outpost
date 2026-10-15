import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supportsMods, writeSparkMod } from './native-mod-script.ts';
import { MOD_SEND_MAX } from './native-mod-telemetry-script.ts';

type Next = ((e: unknown) => unknown) & { origin?: { plugin: string; tier: string } };
type Hook = ($: FakeEngine, e: Record<string, unknown>, next: Next) => unknown;

interface FakeEngine {
  plugin: { root: string };
  fs: { read: (path: string) => Promise<string> };
  http: {
    fetch: (
      url: string,
      init: RequestInit,
    ) => Promise<{ ok: boolean; status?: number; text: string }>;
  };
  clock: { every: (ms: number, fn: () => Promise<void>) => () => void; now: () => Promise<number> };
  session: { usage: () => Promise<{ cost?: { usd: number } }> };
  prompt: { submit: (input: { text: string; asUser: true }) => Promise<unknown> };
  ui: {
    log: (text: string) => void;
    invalidate: (event: string) => void;
    resolve: () => { Text: string };
  };
}

let folder: string;
let hooks: Map<string, Hook>;
let tick: () => Promise<void>;
let requests: { url: string; init: RequestInit }[];
let replies: (() => { ok: boolean; status?: number; text: string })[];
let spent: number;
let submitted: { text: string; asUser: true }[];
let logs: string[];
let redraws: number;
let engine: FakeEngine;

async function writeConfig(url: string, token: string) {
  await writeFile(
    join(folder, 'observer.json'),
    JSON.stringify({ url, token, sessionId: 's', provider: 'claude' }),
  );
}

function reply(body: object) {
  replies.push(() => ({ ok: true, text: JSON.stringify(body) }));
}

function band() {
  const render = hooks.get('ui.render')!;
  return render(engine, { props: { hasSurvey: false } }, () => 'engine band');
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'spark-mod-'));
  const root = await writeSparkMod(folder);
  await writeConfig('http://127.0.0.1:4100/events', 'first-token');
  hooks = new Map();
  requests = [];
  replies = [];
  submitted = [];
  logs = [];
  redraws = 0;
  spent = 0;
  engine = {
    plugin: { root },
    fs: { read: (path) => readFile(path, 'utf8') },
    http: {
      fetch: async (url, init) => {
        requests.push({ url, init });
        const next = replies.shift();
        if (!next) throw new Error('connection refused');
        return next();
      },
    },
    clock: {
      every: (_ms, fn) => {
        tick = fn;
        return () => undefined;
      },
      now: async () => 1_792_000_000_000.4,
    },
    session: { usage: async () => ({ cost: { usd: spent } }) },
    prompt: {
      submit: async (input) => {
        submitted.push(input);
        return { text: input.text };
      },
    },
    ui: {
      log: (text) => logs.push(text),
      invalidate: () => (redraws += 1),
      resolve: () => ({ Text: 'Text' }),
    },
  };
  Object.assign(globalThis, {
    h: (type: string, props: object, ...children: unknown[]) => ({ type, props, children }),
  });
  const module = (await import(pathToFileURL(join(root, 'hooks/register.js')).href)) as {
    register: (on: (event: string, matcher: unknown, hook?: Hook) => void) => void;
  };
  module.register((event, matcher, hook) => {
    hooks.set(event, (hook ?? matcher) as Hook);
    return { catch: () => undefined };
  });
  await hooks.get('session.start')!(engine, {}, (e) => e);
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('the Spark mod', () => {
  it('asks Spark’s hook host for the inbox with the session token', async () => {
    reply({ messages: [], notices: [], status: null });
    await tick();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('http://127.0.0.1:4100/mod/inbox');
    expect(requests[0]!.init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer first-token' },
    });
  });

  it('submits each queued message as the user’s own prompt and logs approval notices', async () => {
    reply({
      messages: ['run the tests', 'then push'],
      notices: ['Allowed from your phone'],
      status: null,
    });
    await tick();
    expect(submitted).toEqual([
      { text: 'run the tests', asUser: true },
      { text: 'then push', asUser: true },
    ]);
    expect(logs).toEqual(['Allowed from your phone']);
  });

  it('draws the status band above the prompt and leaves it to the engine when there is none', async () => {
    expect(band()).toBe('engine band');
    reply({ messages: [], notices: [], status: 'Spark · phone connected' });
    await tick();
    expect(band()).toEqual({
      type: 'Text',
      props: { dimColor: true, wrap: 'truncate-end' },
      children: ['Spark · phone connected'],
    });
    reply({ messages: [], notices: [], status: 'Spark · phone connected' });
    await tick();
    expect(redraws).toBe(1);
  });

  it('rereads its config after a failed request, so a restarted Spark is found again', async () => {
    reply({ messages: [], notices: [], status: 'Spark · phone connected' });
    await tick();
    await tick();
    expect(band()).toBe('engine band');
    expect(logs).toEqual([]);
    await writeConfig('http://127.0.0.1:4200/events', 'second-token');
    replies.push(() => ({ ok: false, text: '' }));
    await tick();
    reply({ messages: [], notices: [], status: null });
    await tick();
    expect(requests.at(-1)!.url).toBe('http://127.0.0.1:4200/mod/inbox');
    expect(requests.at(-1)!.init.headers).toMatchObject({ Authorization: 'Bearer second-token' });
  });

  it('runs one poll at a time', async () => {
    reply({ messages: [], notices: [], status: null });
    const answered = engine.http.fetch;
    let release = () => undefined as void;
    const held = new Promise<void>((done) => (release = done));
    engine.http.fetch = async (url, init) => {
      await held;
      return answered(url, init);
    };
    const first = tick();
    await tick();
    release();
    await first;
    expect(requests).toHaveLength(1);
  });

  it('ignores malformed inbox entries', async () => {
    reply({ messages: ['ok', 3, { text: 'x' }], notices: 'nope', status: 7 });
    await tick();
    expect(submitted).toEqual([{ text: 'ok', asUser: true }]);
    expect(logs).toEqual([]);
    expect(band()).toBe('engine band');
  });

  it('says once in the terminal when Claude drops a message', async () => {
    engine.prompt.submit = async () => ({ drop: 'policy' });
    reply({ messages: ['hello'], notices: [], status: null });
    await tick();
    await new Promise((done) => setTimeout(done, 0));
    expect(logs).toEqual(['Spark: a message from your phone was not sent. Type it here instead.']);
  });
});

async function step(e: Record<string, unknown>, usage: Record<string, unknown> | null) {
  const hook = hooks.get('turn.step') as unknown as (
    ...args: Parameters<Hook>
  ) => AsyncGenerator<unknown, unknown, unknown>;
  const generator = hook(engine, e, async function* () {
    yield { kind: 'text', text: 'hello' };
    return { usage };
  } as unknown as Next);
  let next = await generator.next();
  while (!next.done) next = await generator.next();
  return next.value;
}

const ENGINE = { plugin: 'engine', tier: 'core' };

async function oneTurn() {
  const engineCall: Next = Object.assign((e: unknown) => e, { origin: ENGINE });
  await hooks.get('classic.UserPromptSubmit')!(engine, { prompt_id: 'prompt-1' }, engineCall);
  await hooks.get('turn.start')!(engine, { turnId: 'turn-1', text: 'secret prompt' }, engineCall);
  const call = { tool: 'Bash', tool_use_id: 'toolu_1', command: 'cat .env', description: 'x' };
  const ran = async () => ({ isError: true, text: 'tool-printed-this' });
  await hooks.get('tool.call')!(engine, call, Object.assign(ran, { origin: ENGINE }));
  spent = 0.25;
  const usage = {
    input_tokens: 3,
    output_tokens: 40,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 100,
    model: 'claude-opus-5-5',
  };
  await step({ turnId: 'turn-1', index: 0, model: 'claude-opus-5-5' }, usage);
  await hooks.get('turn.complete')!(
    engine,
    { turnId: 'turn-1', durationMs: 1234.6, isAborted: false, answer: 'secret reply' },
    engineCall,
  );
}

function sentItems(index: number) {
  return JSON.parse(String(requests[index]!.init.body)) as { items: Record<string, unknown>[] };
}

describe('the Spark mod’s turn facts', () => {
  it('sends Spark only names, times, token counts and cost, never commands, prompts or replies', async () => {
    await oneTurn();
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: true, status: 204, text: '' }));
    await tick();
    expect(requests[1]!.url).toBe('http://127.0.0.1:4100/mod/telemetry');
    expect(requests[1]!.init.headers).toMatchObject({ Authorization: 'Bearer first-token' });
    const { items } = sentItems(1);
    const at = 1_792_000_000_000;
    expect(items).toEqual([
      { kind: 'turn_start', prompt: 'prompt-1', agent: null, turn: 'turn-1', at },
      {
        kind: 'tool',
        prompt: 'prompt-1',
        agent: null,
        id: 'toolu_1',
        name: 'Bash',
        phase: 'start',
        failed: false,
        at,
      },
      {
        kind: 'tool',
        prompt: 'prompt-1',
        agent: null,
        id: 'toolu_1',
        name: 'Bash',
        phase: 'end',
        failed: true,
        at,
      },
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
        at,
        durationMs: 1235,
        aborted: false,
      },
    ]);
    expect(String(requests[1]!.init.body)).not.toMatch(
      /cat \.env|secret|description|tool-printed-this/,
    );
  });

  it('keeps the facts for the next poll when Spark is away or the token is stale', async () => {
    await oneTurn();
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: false, status: 401, text: '' }));
    await tick();
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: true, status: 204, text: '' }));
    await tick();
    expect(sentItems(3).items).toEqual(sentItems(1).items);
    reply({ messages: [], notices: [], status: null });
    await tick();
    expect(requests).toHaveLength(5);
  });

  it('sends the facts in batches of a bounded size', async () => {
    await hooks.get('classic.UserPromptSubmit')!(engine, { prompt_id: 'p' }, (e) => e);
    for (let index = 0; index < 225; index++)
      await hooks.get('tool.call')!(
        engine,
        { tool: 'Read', tool_use_id: `toolu_${index}` },
        async () => ({}),
      );
    reply({ messages: [], notices: [], status: null });
    for (let round = 0; round < 3; round++)
      replies.push(() => ({ ok: true, status: 204, text: '' }));
    await tick();
    expect([1, 2, 3].map((index) => sentItems(index).items.length)).toEqual([
      MOD_SEND_MAX,
      MOD_SEND_MAX,
      450 - 2 * MOD_SEND_MAX,
    ]);
  });

  it('drops a batch Spark turned down, so one bad item never blocks the rest', async () => {
    await oneTurn();
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: false, status: 400, text: '' }));
    await tick();
    reply({ messages: [], notices: [], status: null });
    await tick();
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/mod/inbox',
      '/mod/telemetry',
      '/mod/inbox',
    ]);
  });

  it('attributes a subagent to the turn that started it and skips facts other mods raised', async () => {
    const engineCall = Object.assign((e: unknown) => e, {
      origin: { plugin: 'engine', tier: 'core' },
    });
    const pluginCall = Object.assign((e: unknown) => e, {
      origin: { plugin: 'other-mod', tier: 'user' },
    });
    await hooks.get('classic.UserPromptSubmit')!(engine, { prompt_id: 'prompt-1' }, engineCall);
    await hooks.get('turn.start')!(engine, { turnId: 'sub-1', agentId: 'agent-a' }, engineCall);
    await hooks.get('classic.UserPromptSubmit')!(engine, { prompt_id: 'prompt-2' }, engineCall);
    await hooks.get('turn.start')!(engine, { turnId: 'mine', agentId: 'agent-b' }, pluginCall);
    await hooks.get('turn.complete')!(
      engine,
      { turnId: 'sub-1', agentId: 'agent-a', durationMs: 5, isAborted: true },
      engineCall,
    );
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: true, status: 204, text: '' }));
    await tick();
    expect(sentItems(1).items.map((item) => [item.kind, item.prompt, item.agent])).toEqual([
      ['turn_start', 'prompt-1', 'agent-a'],
      ['turn_end', 'prompt-1', 'agent-a'],
    ]);
  });
});

describe('the Spark mod when sends fail or requests overlap', () => {
  it('keeps the facts when the request to Spark fails outright, and sends them next time', async () => {
    await oneTurn();
    reply({ messages: [], notices: [], status: null });
    await tick();
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/mod/inbox',
      '/mod/telemetry',
    ]);
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: true, status: 204, text: '' }));
    await tick();
    expect(sentItems(3).items).toEqual(sentItems(1).items);
  });

  it('reads Claude Code’s cost one request at a time, so overlapping requests never count twice', async () => {
    const usage = {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      model: 'claude-opus-5-5',
    };
    let release = () => undefined as void;
    const held = new Promise<void>((done) => (release = done));
    let calls = 0;
    engine.session.usage = async () => {
      calls += 1;
      const seen = spent;
      if (calls === 1) await held;
      return { cost: { usd: seen } };
    };
    await hooks.get('classic.UserPromptSubmit')!(engine, { prompt_id: 'p' }, (e) => e);
    await hooks.get('turn.start')!(engine, { turnId: 'main' }, (e) => e);
    await hooks.get('turn.start')!(engine, { turnId: 'sub', agentId: 'agent-a' }, (e) => e);
    spent = 0.1;
    const first = step({ turnId: 'main', index: 0 }, usage);
    await new Promise((done) => setTimeout(done, 0));
    spent = 0.25;
    const second = step({ turnId: 'sub', index: 0, agentId: 'agent-a' }, usage);
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toBe(1);
    release();
    await Promise.all([first, second]);
    reply({ messages: [], notices: [], status: null });
    replies.push(() => ({ ok: true, status: 204, text: '' }));
    await tick();
    const costs = sentItems(1)
      .items.filter((item) => item.kind === 'request')
      .map((item) => item.costUsd);
    expect(costs).toEqual([0.1, 0.15]);
  });
});

describe('mod support', () => {
  it('needs Claude Code 2.1.287 or newer', () => {
    expect(supportsMods('2.1.287 (Claude Code)')).toBe(true);
    expect(supportsMods('2.1.294 (Claude Code)')).toBe(true);
    expect(supportsMods('2.2.0')).toBe(true);
    expect(supportsMods('3.0.1')).toBe(true);
    expect(supportsMods('2.1.286 (Claude Code)')).toBe(false);
    expect(supportsMods('2.0.999')).toBe(false);
    expect(supportsMods('')).toBe(false);
  });
});
