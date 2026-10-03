import type { AdviceUsage } from '@spark-outpost/contracts';
import { AdvisorError, AdvisorTimeoutError } from './advice.ts';
import { systemOneResponseSchema, type SystemOneResponse } from './intake-questions.ts';
import { breakerFor, JEV_PAUSED, type JevBreaker } from './jev-breaker.ts';
import { JEV_CALLS_IN_FLIGHT, JevLimiter } from './jev-limiter.ts';

export interface JevOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  limiter?: JevLimiter;
  breaker?: JevBreaker;
  random?: () => number;
}

export const JEV_TIMEOUT_MS = 10_000;
export const JEV_INPUT_USD_PER_MILLION = 0.042;
export const JEV_LATEST = 'jev-latest';
export const JEV_TUNED_MODEL = 'jev-1.13.0';
export const RETRY_BASE_MS = 500;
export const RETRY_JITTER = 0.25;
export const MIN_RETRY_BUDGET_MS = 1_000;
const RETRYABLE = new Set([429, 529]);
const CHARACTERS_PER_TOKEN = 4;

export const jevLimiter = new JevLimiter(JEV_CALLS_IN_FLIGHT);

function failureMessage(status: number): string {
  if (status === 401) return 'TypeSafe rejected the Jev key (401 Unauthorized). Verify it again.';
  if (status === 422) return 'TypeSafe could not read the Jev request (422).';
  if (status === 429) return 'Jev is rate limited (429 Too Many Requests). Try again shortly.';
  if (status === 529) return 'Jev is overloaded (529). Try again shortly.';
  return `TypeSafe responded with ${status}.`;
}

export function requestModel(model: string): string {
  return model === JEV_LATEST ? JEV_TUNED_MODEL : model;
}

const warnedVersions = new Set<string>();

export function noteJevVersion(answeredBy: string, warn: (message: string) => void = console.warn) {
  if (answeredBy === JEV_TUNED_MODEL || warnedVersions.has(answeredBy)) return;
  warnedVersions.add(answeredBy);
  warn(
    `Jev answered with ${answeredBy}, but the gates were tuned on ${JEV_TUNED_MODEL}. Confidence lines may mean something different until they are measured again.`,
  );
}

export function retryDelayMs(headers: Headers, random: () => number = Math.random): number {
  const exact = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(exact) && exact > 0) return exact;
  const seconds = Number(headers.get('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return RETRY_BASE_MS * (1 - RETRY_JITTER + 2 * RETRY_JITTER * random());
}

export interface SystemOneRequest {
  state: unknown;
  questions: Record<string, unknown>;
}

class JevOutageError extends AdvisorError {}

function jevTimedOut(): AdvisorTimeoutError {
  return new AdvisorTimeoutError('Jev did not answer in time.');
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', stop, { once: true });
  });
}

async function post(
  options: JevOptions,
  body: SystemOneRequest,
  signal: AbortSignal,
  timeout: AbortSignal,
): Promise<Response> {
  try {
    return await options.fetch(`${options.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...body, model: requestModel(options.model) }),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.aborted) throw jevTimedOut();
    throw new JevOutageError("Couldn't reach TypeSafe.", { cause: error });
  }
}

async function acquire(limiter: JevLimiter, signal: AbortSignal, timeout: AbortSignal) {
  try {
    return await limiter.acquire(AbortSignal.any([signal, timeout]));
  } catch (error) {
    if (signal.aborted) throw error;
    throw jevTimedOut();
  }
}

async function answeredResponse(response: Response, timeout: AbortSignal) {
  const json: unknown = await response.json().catch(() => null);
  if (timeout.aborted) throw jevTimedOut();
  const parsed = systemOneResponseSchema.safeParse(json);
  if (!parsed.success) throw new AdvisorError('Jev returned an answer in an unexpected shape.');
  noteJevVersion(parsed.data.model);
  return parsed.data;
}

function failedResponse(status: number): AdvisorError {
  const message = failureMessage(status);
  return status >= 500 ? new JevOutageError(message) : new AdvisorError(message);
}

async function ask(
  options: JevOptions,
  body: SystemOneRequest,
  signal: AbortSignal,
): Promise<SystemOneResponse> {
  const budgetMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
  const deadline = Date.now() + budgetMs;
  const timeout = AbortSignal.timeout(budgetMs);
  const release = await acquire(options.limiter ?? jevLimiter, signal, timeout);
  try {
    let response = await post(options, body, signal, timeout);
    if (RETRYABLE.has(response.status)) {
      const delay = retryDelayMs(response.headers, options.random);
      if (deadline - Date.now() - delay >= MIN_RETRY_BUDGET_MS) {
        await response.body?.cancel().catch(() => undefined);
        await wait(delay, AbortSignal.any([signal, timeout])).catch((error: unknown) => {
          if (signal.aborted) throw error;
          throw jevTimedOut();
        });
        response = await post(options, body, signal, timeout);
      }
    }
    if (!response.ok) throw failedResponse(response.status);
    return await answeredResponse(response, timeout);
  } finally {
    release();
  }
}

export async function askSystemOne(
  options: JevOptions,
  body: SystemOneRequest,
  signal: AbortSignal,
): Promise<SystemOneResponse> {
  const breaker = options.breaker ?? breakerFor(options.fetch, options.baseUrl);
  if (breaker.paused) throw new AdvisorError(JEV_PAUSED);
  try {
    const response = await ask(options, body, signal);
    breaker.succeeded();
    return response;
  } catch (error) {
    if (error instanceof JevOutageError || error instanceof AdvisorTimeoutError) breaker.failed();
    throw error;
  }
}

export function jevCostUsd(inputTokens: number): number {
  return (inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000;
}

export function jevUsage(body: SystemOneRequest, response: SystemOneResponse): AdviceUsage {
  const reported = response.usage;
  const inputTokens = reported
    ? Math.round(reported.input_tokens)
    : Math.ceil(JSON.stringify(body).length / CHARACTERS_PER_TOKEN);
  return {
    inputTokens,
    outputTokens: Math.round(reported?.output_tokens ?? 0),
    tokenSource: reported ? 'reported' : 'estimated',
    costUsd: jevCostUsd(inputTokens),
    costSource: 'estimated',
  };
}
