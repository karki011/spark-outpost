import { decodesToCredential, percentDecodedAscii } from './secret-decode.ts';

export const redacted = (kind: string) => `[redacted:${kind}]`;
export const REDACTED_MARKER = /\[redacted:[a-z_]+\]/g;
export const REMOVED_SECRET = '[removed]';

interface SecretParts {
  kind: string;
  before: string;
  value: string;
  after: string;
}

interface TextRule {
  kind: string;
  pattern: RegExp;
  split?: (match: string, groups: string[]) => SecretParts | null;
  checksValue?: boolean;
  requires?: string;
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

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
export const ENV_KEY = /[A-Za-z_\u200B-\u200D\u2060\uFEFF][A-Za-z0-9_.\u200B-\u200D\u2060\uFEFF-]*/;

export function isSensitiveEnvKey(key: string): boolean {
  const upper = key.replace(INVISIBLE, '').toUpperCase();
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

const keepPrefix =
  (kind: string, isSecret: (value: string) => boolean = () => true) =>
  (match: string, [prefix = '']: string[]): SecretParts | null => {
    const value = match.slice(prefix.length).trim();
    return isSecret(value) ? { kind, before: `${prefix} `, value, after: '' } : null;
  };

function looksLikeBearerToken(value: string): boolean {
  if (/\d/.test(value)) return true;
  return value.length >= 20 && /[a-z]/.test(value) && /[A-Z]/.test(value);
}

function looksLikeBasicCredential(value: string): boolean {
  return decodesToCredential(value) || (value.length >= 16 && /\d/.test(value));
}

const URL_SCHEME_START = /^[a-z]|[+.-][a-z]/i;

function hasUrlScheme(before: string): boolean {
  return URL_SCHEME_START.test(before.slice(0, before.indexOf('://')));
}

const JWT_RULE: TextRule = {
  kind: 'jwt',
  pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
};

const PREFIXED_TOKEN_RULES: TextRule[] = [
  { kind: 'github_token', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'github_token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'slack_token', pattern: /\b(?:xoxe\.)?x(?:ox[abeposr]|app)-[A-Za-z0-9-]{10,}/g },
  { kind: 'api_key', pattern: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { kind: 'api_key', pattern: /\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: 'api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'aws_key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
];

const ENCODED_TOKEN_RULES = [JWT_RULE, ...PREFIXED_TOKEN_RULES];

function encodedToken(match: string): SecretParts | null {
  if (!match.includes('%')) return null;
  const decoded = percentDecodedAscii(match);
  for (const rule of ENCODED_TOKEN_RULES) {
    const [token] = decoded.match(rule.pattern) ?? [];
    if (token) return { kind: rule.kind, before: '', value: token, after: '' };
  }
  return null;
}

const TEXT_RULES: TextRule[] = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  JWT_RULE,
  {
    kind: 'bearer',
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    split: keepPrefix('bearer', looksLikeBearerToken),
  },
  {
    kind: 'basic_auth',
    pattern: /\b(Basic)\s+[A-Za-z0-9+/]{8,}={0,2}(?![A-Za-z0-9+/=._~-])/gi,
    split: keepPrefix('basic_auth', looksLikeBasicCredential),
  },
  {
    kind: 'github_token',
    pattern: /\b(Authorization:\s*token)\s+[A-Za-z0-9_.-]{8,}/gi,
    split: keepPrefix('github_token'),
  },
  ...PREFIXED_TOKEN_RULES,
  {
    kind: 'encoded_token',
    requires: '%',
    pattern: /(?<![\w%.~+-])[\w%.~+-]{20,}/g,
    split: encodedToken,
  },
  {
    kind: 'url_password',
    requires: '://',
    pattern: /(?<![a-z0-9+.-])([a-z0-9+.-]*:\/\/[^\s:/?#@]+:)((?:[^\s@/]|@(?=[^\s/?#@]*@))+)(@)/gi,
    split: (_match, [before = '', value = '', after = '']) =>
      hasUrlScheme(before) && value !== REMOVED_SECRET
        ? { kind: 'url_password', before, value, after }
        : null,
  },
  {
    kind: 'env',
    pattern: new RegExp(
      `^([ \\t]*(?:export[ \\t]+)?)(${ENV_KEY.source})([ \\t]*=[ \\t]*)(.*\\S.*)$`,
      'gm',
    ),
    checksValue: true,
    split: (_match, [prefix = '', key = '', equals = '', value = '']) =>
      isSensitiveEnvKey(key)
        ? { kind: 'env', before: `${prefix}${key}${equals}`, value, after: '' }
        : null,
  },
  {
    kind: 'json_field',
    pattern: /("([^"\\]{1,80})"\s*:\s*)"((?:[^"\\]|\\.)*)"/g,
    checksValue: true,
    split: (_match, [before = '', key = '', value = '']) => {
      const kind = sensitiveFieldKind(key);
      return kind ? { kind, before: `${before}"`, value, after: '"' } : null;
    },
  },
];

interface SecretMatch extends SecretParts {
  rule: TextRule;
}

function parts(rule: TextRule, match: string, rest: unknown[]): SecretMatch | null {
  const groups = rest.filter((value): value is string => typeof value === 'string');
  const split = rule.split
    ? rule.split(match, groups)
    : { kind: rule.kind, before: '', value: match, after: '' };
  return split ? { ...split, rule } : null;
}

function appliesTo(rule: TextRule, text: string): boolean {
  return rule.requires === undefined || text.includes(rule.requires);
}

function replaceSecrets(text: string, replacement: (secret: SecretMatch) => string | null): string {
  let result = text;
  for (const rule of TEXT_RULES) {
    if (!appliesTo(rule, result)) continue;
    result = result.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      if (match.startsWith('[redacted:')) return match;
      const secret = parts(rule, match, rest);
      const marker = secret ? replacement(secret) : null;
      return secret && marker !== null ? `${secret.before}${marker}${secret.after}` : match;
    });
  }
  return result;
}

export function redactText(text: string): string {
  return replaceSecrets(text, (secret) => redacted(secret.kind));
}

const PLACEHOLDER =
  /^(?:\[redacted:|\[removed\]|[<${(*]|x{3,}|\.{3})|^(?:your|my|some|example|sample|placeholder|changeme|change_me|dummy|fake|test|todo|none|null|undefined|true|false)(?:[\W_]|$)/i;

function unquoted(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

function looksSecret(raw: string): boolean {
  const value = unquoted(raw);
  if (value.length < 8 || /\s/.test(value) || PLACEHOLDER.test(value)) return false;
  return /\d/.test(value) || value.length >= 20;
}

function scanned(text: string, keep: (secret: SecretMatch) => boolean): SecretMatch[] {
  const found: SecretMatch[] = [];
  for (const rule of TEXT_RULES) {
    if (!appliesTo(rule, text)) continue;
    for (const match of text.matchAll(rule.pattern)) {
      const [whole, ...groups] = match;
      if (whole.startsWith('[redacted:')) continue;
      const secret = parts(rule, whole, groups);
      if (secret && keep(secret)) found.push(secret);
    }
  }
  return found;
}

export function secretKinds(text: string): string[] {
  const found = scanned(text, (secret) => !secret.rule.checksValue || looksSecret(secret.value));
  return [...new Set(found.map((secret) => secret.rule.kind))];
}

const RANDOM_VALUE = /^[A-Za-z0-9_\-+/=~]{16,}$/;

function looksRandom(raw: string): boolean {
  const value = unquoted(raw);
  return (
    looksSecret(value) && RANDOM_VALUE.test(value) && /\d/.test(value) && /[A-Za-z]/.test(value)
  );
}

function pastedSecret(secret: SecretMatch): boolean {
  if (secret.rule.checksValue) return looksRandom(secret.value);
  if (secret.kind === 'api_key') return /\d/.test(secret.value);
  return true;
}

function removeEach(text: string, onRemove: (kind: string) => void = () => undefined): string {
  return replaceSecrets(text, (secret) => {
    if (!pastedSecret(secret)) return null;
    onRemove(secret.kind);
    return REMOVED_SECRET;
  });
}

export function pastedSecretKinds(text: string): string[] {
  const kinds = new Set<string>();
  removeEach(text, (kind) => kinds.add(kind));
  return [...kinds];
}

export function removePastedSecrets(text: string): string {
  return removeEach(text);
}
