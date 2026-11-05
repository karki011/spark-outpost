import { describe, expect, it } from 'vitest';
import { AdvisorError, AdvisorTimeoutError } from './jev-errors.ts';
import {
  breakerFor,
  JEV_PAUSE_AFTER,
  JEV_PAUSE_MS,
  JEV_PAUSED,
  JevBreaker,
} from './jev-breaker.ts';
import { askSystemOne, type JevOptions } from './jev.ts';
import { JevLimiter } from './jev-limiter.ts';

const body = { state: { task: 'Fix the typo' }, questions: {} };
const answered = { model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 10 } };
const signal = () => new AbortController().signal;

function counted(reply: (call: number, init?: RequestInit) => Promise<Response>) {
  const state = { calls: 0 };
  const fetcher: typeof fetch = async (_input, init) => {
    state.calls += 1;
    return reply(state.calls, init);
  };
  return { state, fetcher };
}

const ok = async () => new Response(JSON.stringify(answered), { status: 200 });
const down = async () => new Response('down', { status: 503 });
const refused = async (): Promise<Response> => {
  throw new TypeError('fetch failed');
};
const silent = (_call: number, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const stopped = init?.signal;
    if (stopped?.aborted) reject(stopped.reason);
    stopped?.addEventListener('abort', () => reject(stopped.reason));
  });

function options(fetcher: typeof fetch, overrides: Partial<JevOptions> = {}): JevOptions {
  return {
    baseUrl: 'https://jev.test',
    apiKey: 'fake',
    model: 'jev-latest',
    fetch: fetcher,
    timeoutMs: 30,
    limiter: new JevLimiter(4),
    ...overrides,
  };
}

async function failTimes(count: number, ask: JevOptions): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (let attempt = 0; attempt < count; attempt += 1) {
    errors.push(await askSystemOne(ask, body, signal()).catch((error: unknown) => error));
  }
  return errors;
}

describe('Jev breaker', () => {
  it.each([
    ['is unreachable', refused, AdvisorError],
    ['answers with a server error', down, AdvisorError],
    ['never answers', silent, AdvisorTimeoutError],
  ])(
    'stops calling Jev for a moment when it %s several times in a row',
    async (_name, reply, kind) => {
      let now = 1_000;
      const breaker = new JevBreaker(() => now);
      const { state, fetcher } = counted(reply);
      const ask = options(fetcher, { breaker });

      const errors = await failTimes(JEV_PAUSE_AFTER, ask);
      expect(errors.every((error) => error instanceof kind)).toBe(true);
      expect(state.calls).toBe(JEV_PAUSE_AFTER);

      const wouldWaitAMinute = options(fetcher, { breaker, timeoutMs: 60_000 });
      await expect(askSystemOne(wouldWaitAMinute, body, signal())).rejects.toThrow(JEV_PAUSED);
      expect(state.calls).toBe(JEV_PAUSE_AFTER);

      now += JEV_PAUSE_MS;
      await askSystemOne(ask, body, signal()).catch(() => undefined);
      expect(state.calls).toBe(JEV_PAUSE_AFTER + 1);
      await expect(askSystemOne(ask, body, signal())).rejects.toThrow(JEV_PAUSED);
    },
  );

  it('starts counting again after an answer', async () => {
    const breaker = new JevBreaker();
    const { state, fetcher } = counted((call) => (call % JEV_PAUSE_AFTER === 0 ? ok() : down()));
    const ask = options(fetcher, { breaker });
    for (let round = 0; round < 3; round += 1) {
      await failTimes(JEV_PAUSE_AFTER - 1, ask);
      await expect(askSystemOne(ask, body, signal())).resolves.toMatchObject(answered);
    }
    expect(state.calls).toBe(JEV_PAUSE_AFTER * 3);
    expect(breaker.paused).toBe(false);
  });

  it('does not pause for a rejected key or a caller that stopped waiting', async () => {
    const breaker = new JevBreaker();
    const rejected = counted(async () => new Response('no', { status: 401 }));
    await failTimes(JEV_PAUSE_AFTER + 2, options(rejected.fetcher, { breaker }));
    expect(rejected.state.calls).toBe(JEV_PAUSE_AFTER + 2);

    const hanging = counted(silent);
    for (let attempt = 0; attempt < JEV_PAUSE_AFTER + 1; attempt += 1) {
      const stop = new AbortController();
      const asking = askSystemOne(
        options(hanging.fetcher, { breaker, timeoutMs: 5_000 }),
        body,
        stop.signal,
      );
      stop.abort(new Error('stopped'));
      await expect(asking).rejects.toThrow('stopped');
    }
    expect(breaker.paused).toBe(false);
  });

  it('does not pause Jev for a short-deadline observer that opts out', async () => {
    const breaker = new JevBreaker();
    const { state, fetcher } = counted(silent);
    const ask = options(fetcher, { breaker, pauseOnFailure: false });
    const errors = await failTimes(JEV_PAUSE_AFTER + 1, ask);
    expect(errors.every((error) => error instanceof AdvisorTimeoutError)).toBe(true);
    expect(state.calls).toBe(JEV_PAUSE_AFTER + 1);
    expect(breaker.paused).toBe(false);
  });

  it('keeps one breaker per transport and base URL', () => {
    const first: typeof fetch = async () => new Response();
    const second: typeof fetch = async () => new Response();
    expect(breakerFor(first, 'https://a.test')).toBe(breakerFor(first, 'https://a.test'));
    expect(breakerFor(first, 'https://a.test')).not.toBe(breakerFor(first, 'https://b.test'));
    expect(breakerFor(first, 'https://a.test')).not.toBe(breakerFor(second, 'https://a.test'));
  });
});
