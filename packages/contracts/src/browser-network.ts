import { z } from 'zod';
import { BROWSER_URL_MAX } from './browser.ts';

export const BROWSER_NETWORK_CAPACITY = 1000;
export const BROWSER_INITIATOR_MAX = 600;
export const QUERY_VALUE_HIDDEN = '[redacted]';

const SECRET_WORDS = new Set([
  'token',
  'key',
  'secret',
  'code',
  'state',
  'password',
  'passwd',
  'pass',
  'pwd',
  'signature',
  'sig',
  'auth',
  'session',
  'sid',
  'jwt',
  'assertion',
  'credential',
  'otp',
  'nonce',
]);

const SECRET_NAMES = new Set([
  'apikey',
  'accesstoken',
  'idtoken',
  'refreshtoken',
  'authtoken',
  'clientsecret',
  'sessionid',
  'sessiontoken',
  'samlresponse',
  'samlrequest',
]);

function decodedName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

export function secretQueryName(raw: string): boolean {
  const name = decodedName(raw).trim();
  if (SECRET_NAMES.has(name.toLowerCase().replace(/[^a-z0-9]/g, ''))) return true;
  return nameWords(name).some((word) => SECRET_WORDS.has(word));
}

function redactPairs(query: string): string {
  return query
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      if (equals === -1) return pair;
      const name = pair.slice(0, equals);
      return secretQueryName(name) ? `${name}=${QUERY_VALUE_HIDDEN}` : pair;
    })
    .join('&');
}

export function redactQuery(url: string): string {
  const hash = url.indexOf('#');
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const fragment = hash === -1 ? '' : url.slice(hash + 1);
  const question = beforeHash.indexOf('?');
  const base = question === -1 ? beforeHash : beforeHash.slice(0, question);
  const query = question === -1 ? null : beforeHash.slice(question + 1);
  const shownQuery = query === null ? '' : `?${redactPairs(query)}`;
  const shownFragment =
    hash === -1 ? '' : `#${fragment.includes('=') ? redactPairs(fragment) : fragment}`;
  return `${base}${shownQuery}${shownFragment}`;
}

export const browserNetworkEntrySchema = z.object({
  at: z.string(),
  method: z.string().max(12),
  url: z.string().max(BROWSER_URL_MAX),
  status: z.number().int().nullable(),
  type: z.string().max(40).nullable(),
  initiator: z.string().max(BROWSER_INITIATOR_MAX).nullable(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative().nullable(),
  encodedBytes: z.number().int().nonnegative().nullable(),
  decodedBytes: z.number().int().nonnegative().nullable(),
  fromCache: z.boolean(),
  failed: z.string().max(200).nullable(),
});
export type BrowserNetworkEntry = z.infer<typeof browserNetworkEntrySchema>;
