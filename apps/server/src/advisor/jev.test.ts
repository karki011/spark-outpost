import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdvisorError, AdvisorTimeoutError } from './advice.ts';
import { askSystemOne, jevCostUsd, jevUsage, type JevOptions } from './jev.ts';

const FAKE_KEY = 'fake-jev-key-for-tests';

interface Received {
  authorization: string | undefined;
  body: { model: string; state: unknown; questions: Record<string, unknown> };
}

type Reply = () => { status: number; body: unknown; delayMs?: number };

let server: Server;
let baseUrl: string;
let reply: Reply;
let received: Received[];

async function readJson(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return JSON.parse(text);
}

beforeEach(async () => {
  received = [];
  server = createServer(async (req, res) => {
    received.push({
      authorization: req.headers.authorization,
      body: (await readJson(req)) as Received['body'],
    });
    const answer = reply();
    if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
    if (res.destroyed) return;
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const options = (overrides: Partial<JevOptions> = {}): JevOptions => ({
  baseUrl,
  apiKey: FAKE_KEY,
  model: 'jev-latest',
  fetch,
  ...overrides,
});

const body = { state: { task: 'Fix the typo' }, questions: { intent: { type: 'choice' } } };
const answered = {
  model: 'jev-1.13.0',
  answers: {},
  usage: { input_tokens: 400, output_tokens: 0 },
};

describe('askSystemOne', () => {
  it('posts the state and questions once with the key, pinning jev-latest to the tuned version', async () => {
    reply = () => ({ status: 200, body: answered });
    const response = await askSystemOne(options(), body, new AbortController().signal);
    expect(response.model).toBe('jev-1.13.0');
    expect(received).toHaveLength(1);
    expect(received[0]!.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(received[0]!.body).toEqual({ ...body, model: 'jev-1.13.0' });
  });

  it.each([
    [401, 'TypeSafe rejected the Jev key (401 Unauthorized). Verify it again.'],
    [422, 'TypeSafe could not read the Jev request (422).'],
    [429, 'Jev is rate limited (429 Too Many Requests). Try again shortly.'],
    [529, 'Jev is overloaded (529). Try again shortly.'],
    [500, 'TypeSafe responded with 500.'],
  ])('explains a %i response', async (status, message) => {
    reply = () => ({ status, body: { detail: 'nope' } });
    const ask = askSystemOne(options(), body, new AbortController().signal);
    await expect(ask).rejects.toThrow(new AdvisorError(message));
  });

  it('rejects an answer in an unexpected shape', async () => {
    reply = () => ({ status: 200, body: { answers: 'none' } });
    await expect(askSystemOne(options(), body, new AbortController().signal)).rejects.toThrow(
      'Jev returned an answer in an unexpected shape.',
    );
  });

  it('gives up with a timeout error after its limit', async () => {
    reply = () => ({ status: 200, body: answered, delayMs: 2_000 });
    const ask = askSystemOne(options({ timeoutMs: 50 }), body, new AbortController().signal);
    await expect(ask).rejects.toBeInstanceOf(AdvisorTimeoutError);
  });

  it('stops waiting when the caller cancels', async () => {
    reply = () => ({ status: 200, body: answered, delayMs: 2_000 });
    const controller = new AbortController();
    const ask = askSystemOne(options(), body, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(ask).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('Jev usage', () => {
  it('prices reported input tokens at $0.042 per million and output at nothing', () => {
    expect(jevUsage(body, answered)).toEqual({
      inputTokens: 400,
      outputTokens: 0,
      tokenSource: 'reported',
      costUsd: jevCostUsd(400),
      costSource: 'estimated',
    });
    expect(jevCostUsd(1_000_000)).toBeCloseTo(0.042);
  });

  it('estimates tokens from the request size when Jev reports none', () => {
    const usage = jevUsage(body, { model: 'jev', answers: {} });
    expect(usage.tokenSource).toBe('estimated');
    expect(usage.inputTokens).toBe(Math.ceil(JSON.stringify(body).length / 4));
  });
});
