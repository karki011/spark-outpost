import { redactText } from '../audit/redact.ts';
import { TicketApiError } from './source.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = 'Spark-Outpost';

export interface JsonCall {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  authorization: string;
  body?: unknown;
}

export interface JsonAnswer {
  status: number;
  data: unknown;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function callJson(
  fetchImpl: typeof fetch,
  sourceName: string,
  call: JsonCall,
): Promise<JsonAnswer> {
  let response: Response;
  try {
    response = await fetchImpl(call.url, {
      method: call.method,
      headers: {
        accept: 'application/json',
        authorization: call.authorization,
        'user-agent': USER_AGENT,
        ...(call.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TicketApiError(
      0,
      `Couldn't reach ${sourceName}. Check your connection and the site address, then try again.`,
    );
  }
  return { status: response.status, data: parseJson(await response.text()) };
}

function detailOf(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  const messages = Array.isArray(record.errorMessages) ? record.errorMessages : [];
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const first =
    messages[0] ??
    (errors[0] && typeof errors[0] === 'object'
      ? (errors[0] as { message?: unknown }).message
      : null) ??
    record.message;
  return typeof first === 'string' ? redactText(first).slice(0, 200) : '';
}

export function failure(sourceName: string, action: string, answer: JsonAnswer): TicketApiError {
  if (answer.status === 401) {
    return new TicketApiError(
      401,
      `${sourceName} rejected the saved credentials while ${action} (401). Reconnect it in Settings → Connectors.`,
    );
  }
  if (answer.status === 403 || answer.status === 404) {
    return new TicketApiError(
      answer.status,
      `${sourceName} denied access while ${action} (${answer.status}). Check that your account can see this ticket.`,
    );
  }
  const detail = detailOf(answer.data);
  return new TicketApiError(
    answer.status,
    `${sourceName} responded with ${answer.status} while ${action}${detail ? `: ${detail}` : '.'}`,
  );
}

export const isOk = (answer: JsonAnswer) => answer.status >= 200 && answer.status < 300;
