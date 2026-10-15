import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { supportsMods, writeSparkMod } from './native-mod-script.ts';

type Hook = ($: FakeEngine, e: Record<string, unknown>, next: (e: unknown) => unknown) => unknown;

interface FakeEngine {
  plugin: { root: string };
  fs: { read: (path: string) => Promise<string> };
  http: { fetch: (url: string, init: RequestInit) => Promise<{ ok: boolean; text: string }> };
  clock: { every: (ms: number, fn: () => Promise<void>) => () => void };
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
let replies: (() => { ok: boolean; text: string })[];
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
    },
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
  module.register((event, matcher, hook) => hooks.set(event, (hook ?? matcher) as Hook));
  hooks.get('session.start')!(engine, {}, (e) => e);
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
