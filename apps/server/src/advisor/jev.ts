import type { AdviceUsage } from '@spark-outpost/contracts';
import { AdvisorError, AdvisorTimeoutError } from './advice.ts';
import { systemOneResponseSchema, type SystemOneResponse } from './intake-questions.ts';

export interface JevOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

export const JEV_TIMEOUT_MS = 10_000;
export const JEV_INPUT_USD_PER_MILLION = 0.042;
const CHARACTERS_PER_TOKEN = 4;

function failureMessage(status: number): string {
  if (status === 401) return 'TypeSafe rejected the Jev key (401 Unauthorized). Verify it again.';
  if (status === 422) return 'TypeSafe could not read the Jev request (422).';
  if (status === 429) return 'Jev is rate limited (429 Too Many Requests). Try again shortly.';
  if (status === 529) return 'Jev is overloaded (529). Try again shortly.';
  return `TypeSafe responded with ${status}.`;
}

export interface SystemOneRequest {
  state: unknown;
  questions: Record<string, unknown>;
}

export async function askSystemOne(
  options: JevOptions,
  body: SystemOneRequest,
  signal: AbortSignal,
): Promise<SystemOneResponse> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? JEV_TIMEOUT_MS);
  let response: Response;
  try {
    response = await options.fetch(`${options.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...body, model: options.model }),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.aborted) throw new AdvisorTimeoutError('Jev did not answer in time.');
    throw new AdvisorError("Couldn't reach TypeSafe.", { cause: error });
  }
  if (!response.ok) throw new AdvisorError(failureMessage(response.status));
  const json: unknown = await response.json().catch(() => null);
  if (timeout.aborted) throw new AdvisorTimeoutError('Jev did not answer in time.');
  const parsed = systemOneResponseSchema.safeParse(json);
  if (!parsed.success) throw new AdvisorError('Jev returned an answer in an unexpected shape.');
  return parsed.data;
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
