import type { AdviceUsage, JevStatus } from '@spark-outpost/contracts';
import { AdvisorError, AdvisorTimeoutError } from '../advisor/advice.ts';
import type { IntakeQuestions, SystemOneResponse } from '../advisor/intake-questions.ts';
import type { IntakeDeps } from '../advisor/intake-recorder.ts';
import { askSystemOne, jevUsage, requestModel } from '../advisor/jev.ts';

export const ORCHESTRATION_JEV_TIMEOUT_MS = 3_000;

export interface JevCall {
  status: JevStatus;
  asked: IntakeQuestions | null;
  response: SystemOneResponse | null;
  error: string | null;
  latencyMs: number | null;
  usage: AdviceUsage | null;
  model: string | null;
}

export interface JevAccess {
  deps: IntakeDeps;
  model: string;
}

const notConnected: JevCall = {
  status: 'not_connected',
  asked: null,
  response: null,
  error: null,
  latencyMs: null,
  usage: null,
  model: null,
};

export async function callJev(
  access: JevAccess | null,
  build: () => IntakeQuestions,
  signal: AbortSignal,
): Promise<JevCall> {
  if (!access) return notConnected;
  const base = { ...notConnected, model: requestModel(access.model) };
  const apiKey = await access.deps.secrets.get('jev').catch(() => null);
  if (!apiKey)
    return { ...base, status: 'failed', error: 'The Jev key is missing from the keychain.' };
  const startedAt = Date.now();
  let asked: IntakeQuestions | null = null;
  try {
    asked = build();
    const response = await askSystemOne(
      {
        baseUrl: access.deps.baseUrl,
        apiKey,
        model: access.model,
        fetch: access.deps.fetch,
        timeoutMs: access.deps.timeoutMs ?? ORCHESTRATION_JEV_TIMEOUT_MS,
      },
      asked,
      signal,
    );
    return {
      ...base,
      status: 'answered',
      model: response.model,
      asked,
      response,
      latencyMs: Date.now() - startedAt,
      usage: jevUsage(asked, response),
    };
  } catch (error) {
    const timedOut = error instanceof AdvisorTimeoutError;
    const message =
      error instanceof AdvisorError
        ? error.message
        : signal.aborted
          ? 'Stopped.'
          : 'Jev failed unexpectedly.';
    return {
      ...base,
      status: timedOut ? 'timed_out' : 'failed',
      asked,
      error: message,
      latencyMs: Date.now() - startedAt,
    };
  }
}
