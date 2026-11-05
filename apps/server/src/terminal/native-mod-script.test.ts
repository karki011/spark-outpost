import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startSparkMod, type SparkModHarness } from '../../test/spark-mod-engine.ts';
import { supportsMods } from './native-mod-script.ts';

let mod: SparkModHarness;

beforeEach(async () => {
  mod = await startSparkMod();
});

afterEach(async () => {
  await mod.cleanup();
});

describe('the Spark mod', () => {
  it('asks Spark’s hook host for the inbox with the session token', async () => {
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    expect(mod.requests).toHaveLength(1);
    expect(mod.requests[0]!.url).toBe('http://127.0.0.1:4100/mod/inbox');
    expect(mod.requests[0]!.init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer first-token' },
    });
  });

  it('submits each queued message as the user’s own prompt and logs approval notices', async () => {
    mod.inbox({
      messages: ['run the tests', 'then push'],
      notices: ['Allowed from your phone'],
      status: null,
    });
    await mod.tick();
    expect(mod.submitted).toEqual([
      { text: 'run the tests', asUser: true },
      { text: 'then push', asUser: true },
    ]);
    expect(mod.logs).toEqual(['Allowed from your phone']);
  });

  it('draws the status band above the prompt and leaves it to the engine when there is none', async () => {
    expect(mod.band()).toBe('engine band');
    mod.inbox({ messages: [], notices: [], status: 'Spark · phone connected' });
    await mod.tick();
    expect(mod.band()).toEqual({
      type: 'Text',
      props: { dimColor: true, wrap: 'truncate-end' },
      children: ['Spark · phone connected'],
    });
    mod.inbox({ messages: [], notices: [], status: 'Spark · phone connected' });
    await mod.tick();
    expect(mod.redraws()).toBe(1);
  });

  it('rereads its config after a failed request, so a restarted Spark is found again', async () => {
    mod.inbox({ messages: [], notices: [], status: 'Spark · phone connected' });
    await mod.tick();
    await mod.tick();
    expect(mod.band()).toBe('engine band');
    expect(mod.logs).toEqual([]);
    await mod.writeConfig('http://127.0.0.1:4200/events', 'second-token');
    mod.replies.push(() => ({ ok: false, text: '' }));
    await mod.tick();
    mod.inbox({ messages: [], notices: [], status: null });
    await mod.tick();
    expect(mod.requests.at(-1)!.url).toBe('http://127.0.0.1:4200/mod/inbox');
    expect(mod.requests.at(-1)!.init.headers).toMatchObject({
      Authorization: 'Bearer second-token',
    });
  });

  it('runs one poll at a time', async () => {
    mod.inbox({ messages: [], notices: [], status: null });
    const answered = mod.engine.http.fetch;
    let release = () => undefined as void;
    const held = new Promise<void>((done) => (release = done));
    mod.engine.http.fetch = async (url, init) => {
      await held;
      return answered(url, init);
    };
    const first = mod.tick();
    await mod.tick();
    release();
    await first;
    expect(mod.requests).toHaveLength(1);
  });

  it('ignores malformed inbox entries', async () => {
    mod.inbox({ messages: ['ok', 3, { text: 'x' }], notices: 'nope', status: 7 });
    await mod.tick();
    expect(mod.submitted).toEqual([{ text: 'ok', asUser: true }]);
    expect(mod.logs).toEqual([]);
    expect(mod.band()).toBe('engine band');
  });

  it('says once in the terminal when Claude drops a message', async () => {
    mod.engine.prompt.submit = async () => ({ drop: 'policy' });
    mod.inbox({ messages: ['hello'], notices: [], status: null });
    await mod.tick();
    await new Promise((done) => setTimeout(done, 0));
    expect(mod.logs).toEqual([
      'Spark: a message from your phone was not sent. Type it here instead.',
    ]);
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
