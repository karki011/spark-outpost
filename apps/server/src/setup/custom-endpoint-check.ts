import { isLoopbackHost, redactText, type CustomEndpoint } from '@spark-outpost/contracts';
import {
  CUSTOM_NO_KEY_TOKEN,
  endpointModels,
  storedEndpointSecret,
} from '../agents/acp/custom-endpoint.ts';
import { bearerMessageRequest } from './messages-request.ts';
import type { CatalogEntry } from '../providers/catalog.ts';
import type { RunCommand } from './command.ts';
import { findCli, type Verification, type VerifyStep } from './verify.ts';

export interface EndpointFetch {
  fetch: typeof fetch;
}

export type EndpointReply = { ok: true; model: string } | { ok: false; reason: string };

const PROMPT = 'Reply with the single word OK.';
const REASON_MAX = 300;
const REDACTED_KEY_MIN = 8;

function withoutKey(text: string, apiKey: string): string {
  return apiKey.length >= REDACTED_KEY_MIN ? text.split(apiKey).join('[redacted]') : text;
}

function serverMessage(payload: unknown, apiKey: string): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const error = (payload as { error?: unknown }).error;
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? (error as { message?: unknown }).message
        : null;
  if (typeof message !== 'string' || !message.trim()) return null;
  if (apiKey && apiKey.length < REDACTED_KEY_MIN && message.includes(apiKey)) return null;
  return redactText(withoutKey(message.trim(), apiKey)).slice(0, REASON_MAX);
}

function withServerMessage(reason: string, payload: unknown, apiKey: string): string {
  const message = serverMessage(payload, apiKey);
  return message ? `${reason} The server said: ${message}` : reason;
}

function isMessagesReply(payload: unknown): payload is { model?: unknown } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    (payload as { type?: unknown }).type === 'message' &&
    Array.isArray((payload as { content?: unknown }).content)
  );
}

function failureReason(
  endpoint: CustomEndpoint,
  apiKey: string,
  model: string,
  status: number,
  payload: unknown,
): string {
  if (status >= 300 && status < 400) {
    return `${endpoint.baseUrl} redirected the request (${status}). Use the address it redirects to.`;
  }
  if (status === 401 || status === 403) {
    const advice = apiKey ? 'Check the API key.' : 'This endpoint needs an API key.';
    return withServerMessage(
      `The endpoint refused the request (${status}). ${advice}`,
      payload,
      apiKey,
    );
  }
  if (status === 404) {
    return withServerMessage(
      `Nothing answered at ${endpoint.baseUrl}/v1/messages for ${model} (404). Check the address and the model name.`,
      payload,
      apiKey,
    );
  }
  if (status === 429) {
    return withServerMessage('The endpoint is rate limiting requests (429).', payload, apiKey);
  }
  return withServerMessage(`The endpoint responded with ${status}.`, payload, apiKey);
}

export async function askEndpoint(
  endpoint: CustomEndpoint,
  apiKey: string,
  deps: EndpointFetch,
  timeoutMs: number,
): Promise<EndpointReply> {
  const request = bearerMessageRequest(
    endpoint.baseUrl,
    apiKey || CUSTOM_NO_KEY_TOKEN,
    endpoint.model,
    PROMPT,
    'manual',
  );
  let response: Response;
  try {
    response = await deps.fetch(request, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return {
      ok: false,
      reason: `Couldn't reach ${endpoint.baseUrl}. Check that the server is running and the address is right.`,
    };
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      reason: failureReason(endpoint, apiKey, endpoint.model, response.status, payload),
    };
  }
  if (!isMessagesReply(payload)) {
    return {
      ok: false,
      reason:
        'The endpoint answered, but not in the Anthropic Messages format. Spark needs a server that speaks the Anthropic Messages API (POST /v1/messages).',
    };
  }
  return { ok: true, model: typeof payload.model === 'string' ? payload.model : endpoint.model };
}

const started = (label: string): VerifyStep => ({ type: 'step_started', label });
const succeeded = (label: string): VerifyStep => ({ type: 'step_succeeded', label });
const failed = (label: string): VerifyStep => ({ type: 'step_failed', label });

const VERIFY_TIMEOUT_MS = 60_000;
export const CUSTOM_KEY_SAVED = 'API key in your keychain';
export const CUSTOM_NO_KEY = 'No API key';

export function sparkPortProblem(baseUrl: string, sparkPorts: ReadonlySet<number>): string | null {
  const url = new URL(baseUrl);
  if (!isLoopbackHost(url.hostname)) return null;
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return sparkPorts.has(port)
    ? `Port ${port} is Spark's own. Use the port your model server listens on.`
    : null;
}

export async function* verifyCustomEndpoint(
  endpoint: CustomEndpoint,
  rawKey: string,
  deps: EndpointFetch,
  sparkPorts: ReadonlySet<number>,
): Verification {
  const apiKey = rawKey.trim();
  yield started('Checking the address');
  const portProblem = sparkPortProblem(endpoint.baseUrl, sparkPorts);
  if (portProblem) {
    yield failed(portProblem);
    return null;
  }
  yield succeeded(`Address looks right: ${endpoint.baseUrl}`);

  yield started(`Sending a test request to ${endpoint.model}`);
  const startedAt = Date.now();
  const reply = await askEndpoint(endpoint, apiKey, deps, VERIFY_TIMEOUT_MS);
  if (!reply.ok) {
    yield failed(reply.reason);
    return null;
  }
  yield succeeded(`${reply.model} answered in ${Date.now() - startedAt} ms`);
  return {
    method: 'api_key',
    detail: endpoint.baseUrl,
    summary: apiKey ? CUSTOM_KEY_SAVED : CUSTOM_NO_KEY,
    models: endpointModels(endpoint),
    secret: storedEndpointSecret(endpoint, apiKey),
  };
}

export interface CustomEndpointVerifyDeps {
  fetch: typeof fetch;
  run: RunCommand;
  loginShell: string | null;
  sparkPorts: ReadonlySet<number>;
}

export async function* verifyCustomEndpointWithCli(
  entry: CatalogEntry,
  endpoint: CustomEndpoint,
  rawKey: string,
  deps: CustomEndpointVerifyDeps,
): Verification {
  const found = yield* findCli(
    entry,
    deps.run,
    deps.loginShell,
    `${entry.name} also needs the \`${entry.cli}\` CLI installed.`,
  );
  if (!found) return null;
  return yield* verifyCustomEndpoint(endpoint, rawKey, deps, deps.sparkPorts);
}
