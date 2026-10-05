import { objectFields } from './object-fields.ts';

export type FailureKind =
  'model_unsupported' | 'quota' | 'rate_limited' | 'auth' | 'context_too_long' | 'overloaded';

export interface FailureSignal {
  text: string;
  category?: string | null;
  errorKind?: string | null;
  status?: number | null;
}

export interface ClassifiedFailure {
  kind: FailureKind;
  model: string | null;
}

interface ErrorBody {
  status: number | null;
  type: string | null;
  code: string | null;
  message: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

function jsonIn(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function errorBody(raw: string): ErrorBody | null {
  const outer = objectFields(jsonIn(raw));
  const inner = objectFields(outer.error);
  const message = text(inner.message) ?? text(outer.message);
  if (message === null) return null;
  return {
    status: typeof outer.status === 'number' ? outer.status : null,
    type: text(inner.type) ?? text(outer.type),
    code: text(inner.code) ?? text(outer.code),
    message,
  };
}

export function plainDetail(raw: string): string {
  return errorBody(raw)?.message ?? raw;
}

const MODEL_REJECTIONS: readonly RegExp[] = [
  /The '([^']+)' model is not supported when using Codex with a ChatGPT account/i,
  /The model [`'"]?([^`'"\s]+?)[`'"]? does not exist or you do not have access to it/i,
  /issue with the selected model \(([^)]+)\)\. It may not exist or you may not have access to it/i,
];
const ANTHROPIC_MODEL_NOT_FOUND = /^model: (\S+)$/i;
const ZAI_UNKNOWN_MODEL = '1211';
const ZAI_NO_BALANCE = '1113';
const ZAI_RATE_LIMITS = new Set(['1302', '1305']);

const QUOTA_TEXT =
  /usage limit|insufficient_quota|exceeded your current quota|credit balance is too low|billing_error/i;
const RATE_LIMIT_TEXT = /\b429\b|rate[\s_-]?limit|too many requests/i;
const AUTH_TEXT =
  /\b401\b|authentication_error|invalid_api_key|token[_ ]expired|token has expired|unauthorized/i;
const CONTEXT_TEXT =
  /context_length_exceeded|prompt is too long|maximum context length|context window/i;
const OVERLOADED_TEXT = /\b529\b|overloaded_error|server is overloaded|serverOverloaded/i;

function zaiPlanQuota(code: string | null): boolean {
  const number = code === null ? Number.NaN : Number(code);
  return number >= 1308 && number <= 1321;
}

function rejectedModel(signal: FailureSignal, body: ErrorBody | null): ClassifiedFailure | null {
  const message = body?.message ?? signal.text;
  for (const pattern of MODEL_REJECTIONS) {
    const match = pattern.exec(message);
    if (match) return { kind: 'model_unsupported', model: match[1] ?? null };
  }
  const anthropic =
    body?.type === 'not_found_error' ? ANTHROPIC_MODEL_NOT_FOUND.exec(message) : null;
  if (anthropic) return { kind: 'model_unsupported', model: anthropic[1] ?? null };
  const named =
    signal.errorKind === 'model_not_found' ||
    body?.code === 'model_not_found' ||
    (body?.code === ZAI_UNKNOWN_MODEL && /unknown model/i.test(message));
  return named ? { kind: 'model_unsupported', model: null } : null;
}

function otherKind(signal: FailureSignal, body: ErrorBody | null): FailureKind | null {
  const { category, errorKind } = signal;
  const status = signal.status ?? body?.status ?? null;
  const code = body?.code ?? null;
  const described = `${body?.type ?? ''} ${code ?? ''} ${body?.message ?? signal.text}`;
  if (
    errorKind === 'billing_error' ||
    errorKind === 'account_on_hold' ||
    code === ZAI_NO_BALANCE ||
    zaiPlanQuota(code) ||
    QUOTA_TEXT.test(described)
  ) {
    return 'quota';
  }
  if (
    status === 429 ||
    category === 'rate_limited' ||
    errorKind === 'rate_limit' ||
    (code !== null && ZAI_RATE_LIMITS.has(code)) ||
    RATE_LIMIT_TEXT.test(described)
  ) {
    return 'rate_limited';
  }
  if (CONTEXT_TEXT.test(described)) return 'context_too_long';
  if (
    status === 401 ||
    category === 'auth_required' ||
    errorKind === 'authentication_failed' ||
    AUTH_TEXT.test(described)
  ) {
    return 'auth';
  }
  if (status === 529 || errorKind === 'overloaded' || OVERLOADED_TEXT.test(described)) {
    return 'overloaded';
  }
  return null;
}

export function classifyFailure(signal: FailureSignal): ClassifiedFailure | null {
  const body = errorBody(signal.text);
  const rejected = rejectedModel(signal, body);
  if (rejected) return rejected;
  const kind = otherKind(signal, body);
  return kind ? { kind, model: null } : null;
}

export function failureText(kind: Exclude<FailureKind, 'model_unsupported'>, agent: string) {
  switch (kind) {
    case 'quota':
      return `${agent} has reached this account's usage limit. Wait for it to reset or check your plan, then try again.`;
    case 'rate_limited':
      return `${agent} is rate limited. Try again in a minute.`;
    case 'auth':
      return `${agent} isn't signed in any more. Open Settings, reconnect ${agent}, and try again.`;
    case 'context_too_long':
      return 'This chat is too long for the model. Start a new chat or compact this one, then try again.';
    case 'overloaded':
      return `${agent} is overloaded right now. Try again in a minute.`;
  }
}
