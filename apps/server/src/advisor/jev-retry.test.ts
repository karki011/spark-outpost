import { describe, expect, it, vi } from 'vitest';
import { AdvisorError } from './jev-errors.ts';
import {
  askSystemOne,
  noteJevVersion,
  requestModel,
  retryDelayMs,
  RETRY_BASE_MS,
  type JevOptions,
} from './jev.ts';
import { JevLimiter } from './jev-limiter.ts';

const body = { state: { task: 'Fix the typo' }, questions: {} };
const answered = { model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 10 } };

function json(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function scripted(replies: (() => Response)[]) {
  const calls: number[] = [];
  const fetcher = vi.fn(async () => {
    calls.push(Date.now());
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    return next();
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const options = (fetcher: typeof fetch, overrides: Partial<JevOptions> = {}): JevOptions => ({
  baseUrl: 'https://jev.test',
  apiKey: 'fake',
  model: 'jev-latest',
  fetch: fetcher,
  timeoutMs: 3_000,
  limiter: new JevLimiter(4),
  random: () => 0.5,
  ...overrides,
});

const signal = () => new AbortController().signal;

describe('Jev retries', () => {
  it.each([429, 529])('retries a %i once and returns the second answer', async (status) => {
    const { fetcher, calls } = scripted([
      () => json(status, { detail: 'busy' }, { 'retry-after-ms': '40' }),
      () => json(200, answered),
    ]);
    const response = await askSystemOne(options(fetcher), body, signal());
    expect(response.model).toBe('jev-1.13.0');
    expect(calls).toHaveLength(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(35);
  });

  it('gives up after one retry and reports the rate limit, so the rules decide', async () => {
    const { fetcher, calls } = scripted([
      () => json(429, {}, { 'retry-after-ms': '10' }),
      () => json(429, {}, { 'retry-after-ms': '10' }),
    ]);
    await expect(askSystemOne(options(fetcher), body, signal())).rejects.toThrow(
      new AdvisorError('Jev is rate limited (429 Too Many Requests). Try again shortly.'),
    );
    expect(calls).toHaveLength(2);
  });

  it('does not retry when the wait would leave under a second of the budget', async () => {
    const { fetcher, calls } = scripted([() => json(529, {}, { 'retry-after': '3' })]);
    await expect(askSystemOne(options(fetcher), body, signal())).rejects.toThrow('overloaded');
    expect(calls).toHaveLength(1);
  });

  it('never retries other failures', async () => {
    const { fetcher, calls } = scripted([() => json(500, {})]);
    await expect(askSystemOne(options(fetcher), body, signal())).rejects.toThrow('500');
    expect(calls).toHaveLength(1);
  });

  it('waits 500 ms with 25% jitter when the server names no delay', () => {
    const none = new Headers();
    expect(retryDelayMs(none, () => 0)).toBe(RETRY_BASE_MS * 0.75);
    expect(retryDelayMs(none, () => 1)).toBe(RETRY_BASE_MS * 1.25);
    expect(retryDelayMs(new Headers({ 'retry-after-ms': '120' }))).toBe(120);
    expect(retryDelayMs(new Headers({ 'retry-after': '2' }))).toBe(2_000);
  });
});

describe('Jev limiter', () => {
  it('keeps at most four calls in flight and runs the rest as slots free up', async () => {
    const limiter = new JevLimiter(4);
    let active = 0;
    let peak = 0;
    const fetcher = (async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return json(200, answered);
    }) as unknown as typeof fetch;
    const asks = Array.from({ length: 10 }, () =>
      askSystemOne(options(fetcher, { limiter }), body, signal()),
    );
    await Promise.all(asks);
    expect(peak).toBe(4);
    expect(limiter.inFlight).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it('drops a queued call when the caller stops it', async () => {
    const limiter = new JevLimiter(1);
    const release = await limiter.acquire(signal());
    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    expect(limiter.queued).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toBeDefined();
    expect(limiter.queued).toBe(0);
    release();
    expect(limiter.inFlight).toBe(0);
  });
});

describe('Jev version', () => {
  it('asks for the tuned version instead of the moving alias', () => {
    expect(requestModel('jev-latest')).toBe('jev-1.13.0');
    expect(requestModel('jev-preview')).toBe('jev-preview');
  });

  it('warns once per version that differs from the tuned one', () => {
    const warn = vi.fn();
    noteJevVersion('jev-1.13.0', warn);
    noteJevVersion('jev-1.14.0', warn);
    noteJevVersion('jev-1.14.0', warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('jev-1.14.0');
  });
});
