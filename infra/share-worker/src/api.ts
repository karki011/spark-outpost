import { mediaType, readLimitedText, clientAddress } from './body.ts';
import { allowHit } from './counters.ts';
import {
  hashPasscode,
  PASSCODE,
  PASSCODE_ITERATIONS,
  randomToken,
  sameText,
  sha256,
} from './crypto.ts';
import type { ShareEnv } from './env.ts';
import { emptyResponse, jsonError, jsonResponse } from './responses.ts';
import {
  discardShare,
  existingShare,
  findShare,
  isRetired,
  putNewShare,
  removeShare,
  retireId,
  type ShareRecord,
} from './storage.ts';
import { parseTheme, type ShareTheme } from './theme.ts';

export const MAX_TITLE_CHARS = 120;
export const MAX_HTML_BYTES = 2_097_152;
export const MAX_CREATE_BODY_BYTES = MAX_HTML_BYTES * 2 + 16_384;
export const CREATE_LIMIT_PER_HOUR = 20;
export const UNKNOWN_DELETE_LIMIT_PER_HOUR = 60;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const EXPIRY_DAYS = [1, 7];
const FIELDS = ['id', 'deleteToken', 'title', 'html', 'expiresInDays', 'passcode', 'theme'];
const REQUIRED = ['id', 'deleteToken', 'title', 'html', 'expiresInDays'];
export const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
export const DELETE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

interface CreateRequest {
  id: string;
  deleteToken: string;
  title: string;
  html: Uint8Array;
  expiresInDays: number;
  passcode: string | null;
  theme: ShareTheme | null;
}

type Parsed = CreateRequest | 'invalid_request' | 'too_large';

function validTitle(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  return [...value].length <= MAX_TITLE_CHARS;
}

function parseCreate(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return 'invalid_request';
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_request';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.every((key) => FIELDS.includes(key))) return 'invalid_request';
  if (!REQUIRED.every((key) => keys.includes(key))) return 'invalid_request';
  const { id, deleteToken, title, html, expiresInDays, passcode } = record;
  const theme = record.theme === undefined ? null : parseTheme(record.theme);
  if (record.theme !== undefined && theme === null) return 'invalid_request';
  if (typeof id !== 'string' || !SHARE_ID.test(id)) return 'invalid_request';
  if (typeof deleteToken !== 'string' || !DELETE_TOKEN.test(deleteToken)) {
    return 'invalid_request';
  }
  if (!validTitle(title) || typeof html !== 'string') return 'invalid_request';
  if (typeof expiresInDays !== 'number' || !EXPIRY_DAYS.includes(expiresInDays)) {
    return 'invalid_request';
  }
  if (passcode !== undefined && (typeof passcode !== 'string' || !PASSCODE.test(passcode))) {
    return 'invalid_request';
  }
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength > MAX_HTML_BYTES) return 'too_large';
  return {
    id,
    deleteToken,
    title,
    html: bytes,
    expiresInDays,
    passcode: passcode ?? null,
    theme,
  };
}

async function storedPasscode(code: string | null) {
  if (code === null) return null;
  const salt = randomToken(16);
  const hash = await hashPasscode(code, salt, PASSCODE_ITERATIONS);
  return { salt, hash, iterations: PASSCODE_ITERATIONS };
}

async function storeShare(
  env: ShareEnv,
  record: ShareRecord,
  html: Uint8Array,
  now: number,
): Promise<ShareRecord | 'conflict'> {
  if (await isRetired(env, record.id)) return 'conflict';
  if (await putNewShare(env, record, html)) {
    if (!(await isRetired(env, record.id))) return record;
    await discardShare(env, record.id);
    return 'conflict';
  }
  const existing = await existingShare(env, record.id, now);
  if (existing.state === 'expired') await removeShare(env, existing.record);
  if (existing.state !== 'live') return 'conflict';
  const sameToken = sameText(existing.record.deleteTokenHash, record.deleteTokenHash);
  return sameToken ? existing.record : 'conflict';
}

export async function createShare(request: Request, env: ShareEnv, now: number) {
  const allowed = await allowHit(
    env.COUNTERS,
    `create:${clientAddress(request)}`,
    now,
    CREATE_LIMIT_PER_HOUR,
    HOUR_MS,
  );
  if (!allowed) return jsonError(429, 'rate_limited');
  if (mediaType(request) !== 'application/json') return jsonError(400, 'invalid_request');
  const body = await readLimitedText(request, MAX_CREATE_BODY_BYTES);
  if ('error' in body) {
    return body.error === 'too_large'
      ? jsonError(413, 'too_large')
      : jsonError(400, 'invalid_request');
  }
  const parsed = parseCreate(body.text);
  if (parsed === 'too_large') return jsonError(413, 'too_large');
  if (parsed === 'invalid_request') return jsonError(400, 'invalid_request');
  const stored = await storeShare(
    env,
    {
      id: parsed.id,
      title: parsed.title,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + parsed.expiresInDays * DAY_MS).toISOString(),
      deleteTokenHash: await sha256(parsed.deleteToken),
      passcode: await storedPasscode(parsed.passcode),
      theme: parsed.theme,
    },
    parsed.html,
    now,
  );
  if (stored === 'conflict') return jsonError(409, 'conflict');
  const { id, expiresAt } = stored;
  const url = `${new URL(request.url).origin}/a/${id}`;
  return jsonResponse(201, { id, url, expiresAt });
}

async function retireUnknown(request: Request, env: ShareEnv, id: string, now: number) {
  if (!SHARE_ID.test(id)) return true;
  if (await isRetired(env, id)) return true;
  const allowed = await allowHit(
    env.COUNTERS,
    `unknown-delete:${clientAddress(request)}`,
    now,
    UNKNOWN_DELETE_LIMIT_PER_HOUR,
    HOUR_MS,
  );
  if (allowed) await retireId(env, id);
  return allowed;
}

export async function deleteShare(request: Request, env: ShareEnv, id: string, now: number) {
  const token = BEARER.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
  if (token === null) return jsonError(404, 'not_found');
  const presented = await sha256(token);
  let record = await findShare(env, id, now);
  if (!record) {
    if (!(await retireUnknown(request, env, id, now))) return jsonError(429, 'rate_limited');
    record = await findShare(env, id, now);
  }
  if (!record || !sameText(presented, record.deleteTokenHash)) {
    return jsonError(404, 'not_found');
  }
  await removeShare(env, record);
  return emptyResponse(204);
}
