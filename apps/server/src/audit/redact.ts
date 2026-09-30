import { isSecretPath } from '../projects/path-policy.ts';

export const redacted = (kind: string) => `[redacted:${kind}]`;
export const REDACTED_MARKER = /\[redacted:[a-z_]+\]/g;

interface TextRule {
  kind: string;
  pattern: RegExp;
  replace?: (match: string, ...groups: string[]) => string;
}

const SENSITIVE_ENV_PARTS = new Set([
  'KEY',
  'APIKEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'PWD',
  'CREDENTIAL',
  'CREDENTIALS',
  'AUTH',
  'PRIVATE',
]);

const SENSITIVE_ENV_ENDINGS = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD'];

export function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (upper.split(/[_.-]/).some((part) => SENSITIVE_ENV_PARTS.has(part))) return true;
  return SENSITIVE_ENV_ENDINGS.some((ending) => upper.endsWith(ending));
}

const FIELD_KINDS: [RegExp, string][] = [
  [/(apikey|accesskey|secretkey|privatekey)$/, 'api_key'],
  [/token$/, 'token'],
  [/(password|passwd)$/, 'password'],
  [/(secret|secrets)$/, 'secret'],
  [/authorization$/, 'authorization'],
  [/(credential|credentials|cookie)$/, 'credential'],
];

export function sensitiveFieldKind(key: string): string | null {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return FIELD_KINDS.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

const TEXT_RULES: TextRule[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  {
    kind: 'bearer',
    pattern: /\b(Bearer)\s+(?=[A-Za-z._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_match, scheme) => `${scheme} ${redacted('bearer')}`,
  },
  {
    kind: 'github_token',
    pattern: /\b(Authorization:\s*token)\s+[A-Za-z0-9_.-]{8,}/gi,
    replace: (_match, header) => `${header} ${redacted('github_token')}`,
  },
  { kind: 'github_token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'slack_token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'api_key', pattern: /\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: 'api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'aws_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: 'url_password',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi,
    replace: (_match, before, _password, at) => `${before}${redacted('url_password')}${at}`,
  },
  {
    kind: 'env',
    pattern: /^([ \t]*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*=[ \t]*)(.*\S.*)$/gm,
    replace: (match, prefix, key, equals) =>
      isSensitiveEnvKey(key) ? `${prefix}${key}${equals}${redacted('env')}` : match,
  },
  {
    kind: 'json_field',
    pattern: /("([^"\\]{1,80})"\s*:\s*)"((?:[^"\\]|\\.)*)"/g,
    replace: (match, before, key) => {
      const kind = sensitiveFieldKind(key);
      return kind ? `${before}"${redacted(kind)}"` : match;
    },
  },
];

export function redactText(text: string): string {
  let result = text;
  for (const rule of TEXT_RULES) {
    result = result.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      if (match.startsWith('[redacted:')) return match;
      const groups = rest.filter((value): value is string => typeof value === 'string');
      return rule.replace ? rule.replace(match, ...groups) : redacted(rule.kind);
    });
  }
  return result;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function storableText(text: string): string {
  return text.replaceAll('\u0000', '\uFFFD').replace(LONE_SURROGATE, '\uFFFD');
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return storableText(redactText(value));
  if (Array.isArray(value)) return value.map(redactValue);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const kind = sensitiveFieldKind(key);
    result[storableText(key)] = kind && child !== null ? redacted(kind) : redactValue(child);
  }
  return result;
}

function looksLikeSecretPath(candidate: string): boolean {
  const trimmed = candidate.replace(/^['"`]+|['"`;,)]+$/g, '');
  if (trimmed === '' || trimmed.length > 4096) return false;
  return isSecretPath(trimmed.replaceAll('\\', '/'));
}

export function mentionsSecretFile(value: unknown): boolean {
  if (typeof value === 'string') return value.split(/[\s=<>|&]+/).some(looksLikeSecretPath);
  if (Array.isArray(value)) return value.some(mentionsSecretFile);
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(mentionsSecretFile);
}
