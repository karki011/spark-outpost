import { secretQueryName } from './browser-network.ts';

export const STORAGE_SECRET_MIN = 8;

const SECRET_KEY_PARTS = [
  'token',
  'auth',
  'session',
  'secret',
  'passw',
  'jwt',
  'credential',
  'bearer',
  'apikey',
  'api_key',
  'oauth',
  'saml',
  'csrf',
  'xsrf',
];
const JWT = /eyJ[\w-]{4,}\.[\w-]{4,}/;
const OPAQUE_RUN = /[A-Za-z0-9+/_=-]{32,}/g;
const JSON_DEPTH_MAX = 4;

export function secretStorageKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_PARTS.some((part) => lower.includes(part)) || secretQueryName(key);
}

function opaqueRuns(text: string): string[] {
  return [...text.matchAll(OPAQUE_RUN)]
    .map((match) => match[0])
    .filter((run) => /[0-9]/.test(run) && /[A-Za-z]/.test(run));
}

function parsedJson(text: string): unknown {
  const start = text.trimStart()[0];
  if (start !== '{' && start !== '[') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function hasSecretJsonKey(value: unknown, depth: number): boolean {
  if (depth > JSON_DEPTH_MAX) return false;
  if (typeof value === 'string') {
    const inner = parsedJson(value);
    return inner !== undefined && hasSecretJsonKey(inner, depth + 1);
  }
  if (Array.isArray(value)) return value.some((item) => hasSecretJsonKey(item, depth + 1));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, inner]) => secretStorageKey(key) || hasSecretJsonKey(inner, depth + 1),
  );
}

export function secretStorageValue(value: string): boolean {
  if (JWT.test(value) || opaqueRuns(value).length > 0) return true;
  const parsed = parsedJson(value);
  return parsed !== undefined && hasSecretJsonKey(parsed, 0);
}

export function secretStorageItem(key: string, value: string): boolean {
  return secretStorageKey(key) || secretStorageValue(value);
}

function stringLeaves(value: unknown, depth: number, into: string[]): void {
  if (depth > JSON_DEPTH_MAX) return;
  if (typeof value === 'string') {
    into.push(value);
    const inner = parsedJson(value);
    if (inner !== undefined) stringLeaves(inner, depth + 1, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const inner of Object.values(value)) stringLeaves(inner, depth + 1, into);
}

export function storageSecretParts(value: string): string[] {
  const parts = [value, ...opaqueRuns(value)];
  stringLeaves(value, 0, parts);
  return [...new Set(parts)].filter((part) => part.length >= STORAGE_SECRET_MIN);
}

interface ShownItem {
  key: string;
  value?: string | undefined;
  masked?: true | undefined;
}

export function withoutStorageSecrets<Item extends ShownItem>(item: Item): Item {
  if (item.value === undefined || !secretStorageItem(item.key, item.value)) return item;
  const shown: Item = { ...item, masked: true };
  delete shown.value;
  return shown;
}

export function withoutCookieValue<Cookie extends object>(cookie: Cookie): Cookie {
  return Object.fromEntries(Object.entries(cookie).filter(([key]) => key !== 'value')) as Cookie;
}
