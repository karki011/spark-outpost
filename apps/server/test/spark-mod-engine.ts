import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeSparkMod } from '../src/terminal/native-mod-script.ts';

export type Next = ((e: unknown) => unknown) & { origin?: { plugin: string; tier: string } };
export type Hook = ($: FakeEngine, e: Record<string, unknown>, next: Next) => unknown;

interface Reply {
  ok: boolean;
  status?: number;
  text: string;
}

export interface FakeEngine {
  plugin: { root: string };
  fs: { read: (path: string) => Promise<string> };
  http: { fetch: (url: string, init: RequestInit) => Promise<Reply> };
  clock: {
    every: (ms: number, fn: () => Promise<void>) => () => void;
    now: () => Promise<number>;
    sleep: (ms: number) => Promise<void>;
  };
  session: { usage: () => Promise<{ cost?: { usd: number } }> };
  prompt: { submit: (input: { text: string; asUser: true }) => Promise<unknown> };
  ui: {
    log: (text: string) => void;
    invalidate: (event: string) => void;
    resolve: () => { Text: string };
  };
}

export const ENGINE = { plugin: 'engine', tier: 'core' };
export const FACT_AT = 1_792_000_000_000;

export const fromEngine = (answer: (e: unknown) => unknown = (e) => e): Next =>
  Object.assign(answer, { origin: ENGINE });

export async function startSparkMod(options: { record?: boolean } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'spark-mod-'));
  const root = await writeSparkMod(folder);
  const writeConfig = (url: string, token: string, record = options.record) =>
    writeFile(
      join(folder, 'observer.json'),
      JSON.stringify({ url, token, sessionId: 's', provider: 'claude', record }),
    );
  await writeConfig('http://127.0.0.1:4100/events', 'first-token');
  const hooks = new Map<string, Hook>();
  const requests: { url: string; init: RequestInit }[] = [];
  const replies: (() => Reply)[] = [];
  const submitted: { text: string; asUser: true }[] = [];
  const logs: string[] = [];
  let redraws = 0;
  let spent = 0;
  let tick: () => Promise<void> = async () => undefined;
  const engine: FakeEngine = {
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
      now: async () => FACT_AT + 0.4,
      sleep: () => new Promise(() => undefined),
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
    register: (on: (event: string, matcher: unknown, hook?: Hook) => unknown) => void;
  };
  module.register((event, matcher, hook) => {
    hooks.set(event, (hook ?? matcher) as Hook);
    return { catch: () => undefined };
  });
  const hook = (event: string) => hooks.get(event)!;
  await hook('session.start')(engine, {}, (e) => e);
  return {
    engine,
    requests,
    replies,
    submitted,
    logs,
    writeConfig,
    hook,
    redraws: () => redraws,
    spend: (usd: number) => (spent = usd),
    tick: () => tick(),
    inbox(body: object) {
      replies.push(() => ({ ok: true, text: JSON.stringify(body) }));
    },
    answer(status: number) {
      replies.push(() => ({ ok: status < 300, status, text: '' }));
    },
    band() {
      return hook('ui.render')(engine, { props: { hasSurvey: false } }, () => 'engine band');
    },
    sentItems(index: number) {
      return JSON.parse(String(requests[index]!.init.body)) as { items: Record<string, unknown>[] };
    },
    async step(e: Record<string, unknown>, usage: Record<string, unknown> | null, answer = '') {
      const run = hook('turn.step') as unknown as (
        ...args: Parameters<Hook>
      ) => AsyncGenerator<unknown, unknown, unknown>;
      const generator = run(engine, e, async function* () {
        yield { kind: 'text', text: answer };
        return { usage, answer };
      } as unknown as Next);
      let next = await generator.next();
      while (!next.done) next = await generator.next();
      return next.value;
    },
    cleanup: () => rm(folder, { recursive: true, force: true }),
  };
}

export type SparkModHarness = Awaited<ReturnType<typeof startSparkMod>>;
