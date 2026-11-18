import { clearAttempts } from './counters.ts';
import { randomToken } from './crypto.ts';
import type { ShareEnv, StoredObject } from './env.ts';
import { storedTheme, type ShareTheme } from './theme.ts';

export interface Passcode {
  salt: string;
  hash: string;
  iterations: number;
}

export interface ShareRecord {
  id: string;
  title: string;
  createdAt: string;
  expiresAt: string;
  deleteTokenHash: string;
  passcode: Passcode | null;
  theme: ShareTheme | null;
}

const SHARE_PREFIX = 'shares/';
const GONE_PREFIX = 'gone/';
const REMOVE_BATCH = 20;

const shareKey = (id: string) => `${SHARE_PREFIX}${id}`;
const goneKey = (id: string) => `${GONE_PREFIX}${id}`;

function toMetadata(record: ShareRecord): Record<string, string> {
  const metadata: Record<string, string> = {
    title: record.title,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    deleteTokenHash: record.deleteTokenHash,
  };
  if (record.passcode) {
    metadata.passcodeSalt = record.passcode.salt;
    metadata.passcodeHash = record.passcode.hash;
    metadata.passcodeIterations = String(record.passcode.iterations);
  }
  if (record.theme) metadata.theme = JSON.stringify(record.theme);
  return metadata;
}

function fromMetadata(id: string, metadata: Record<string, string> = {}): ShareRecord | null {
  const { title, createdAt, expiresAt, deleteTokenHash } = metadata;
  if (!title || !createdAt || !expiresAt || !deleteTokenHash) return null;
  const { passcodeSalt, passcodeHash, passcodeIterations } = metadata;
  const iterations = Number(passcodeIterations);
  const passcode =
    passcodeSalt && passcodeHash && Number.isInteger(iterations) && iterations > 0
      ? { salt: passcodeSalt, hash: passcodeHash, iterations }
      : null;
  if (passcodeHash && !passcode) return null;
  return {
    id,
    title,
    createdAt,
    expiresAt,
    deleteTokenHash,
    passcode,
    theme: storedTheme(metadata.theme),
  };
}

function isExpired(record: ShareRecord, now: number): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export async function putNewShare(
  env: ShareEnv,
  record: ShareRecord,
  html: Uint8Array,
): Promise<boolean> {
  const stored = await env.SHARES.put(shareKey(record.id), html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: toMetadata(record),
    onlyIf: { etagDoesNotMatch: '*' },
  });
  return stored !== null;
}

export type ExistingShare =
  | { state: 'missing' }
  | { state: 'unreadable' }
  | { state: 'expired'; record: ShareRecord }
  | { state: 'live'; record: ShareRecord };

export async function existingShare(
  env: ShareEnv,
  id: string,
  now: number,
): Promise<ExistingShare> {
  const object = await env.SHARES.head(shareKey(id));
  if (!object) return { state: 'missing' };
  const record = fromMetadata(id, object.customMetadata);
  if (!record) return { state: 'unreadable' };
  return isExpired(record, now) ? { state: 'expired', record } : { state: 'live', record };
}

export async function retireId(env: ShareEnv, id: string): Promise<void> {
  await env.SHARES.put(goneKey(id), '', { onlyIf: { etagDoesNotMatch: '*' } });
}

export async function isRetired(env: ShareEnv, id: string): Promise<boolean> {
  return (await env.SHARES.head(goneKey(id))) !== null;
}

interface Removal {
  id: string;
  hasPasscode: boolean;
}

async function removeAll(env: ShareEnv, removals: Removal[]): Promise<void> {
  for (let start = 0; start < removals.length; start += REMOVE_BATCH) {
    const batch = removals.slice(start, start + REMOVE_BATCH);
    await Promise.all(batch.map(({ id }) => retireId(env, id)));
    await env.SHARES.delete(batch.map(({ id }) => shareKey(id)));
    await Promise.all(
      batch.filter((entry) => entry.hasPasscode).map(({ id }) => clearAttempts(env.COUNTERS, id)),
    );
  }
}

export async function removeShare(env: ShareEnv, record: ShareRecord): Promise<void> {
  await removeAll(env, [{ id: record.id, hasPasscode: record.passcode !== null }]);
}

export async function discardShare(env: ShareEnv, id: string): Promise<void> {
  await env.SHARES.delete(shareKey(id));
}

async function liveRecord(env: ShareEnv, id: string, object: StoredObject | null, now: number) {
  if (!object) return null;
  const record = fromMetadata(id, object.customMetadata);
  if (!record) return null;
  if (!isExpired(record, now)) return record;
  await removeShare(env, record);
  return null;
}

export async function findShare(env: ShareEnv, id: string, now: number) {
  return liveRecord(env, id, await env.SHARES.head(shareKey(id)), now);
}

export async function readShare(env: ShareEnv, id: string, now: number): Promise<string | null> {
  const object = await env.SHARES.get(shareKey(id));
  const record = await liveRecord(env, id, object, now);
  if (!object || !record) return null;
  return object.text();
}

export async function removeExpired(env: ShareEnv, now: number): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.SHARES.list({
      prefix: SHARE_PREFIX,
      include: ['customMetadata'],
      ...(cursor === undefined ? {} : { cursor }),
    });
    const removals: Removal[] = [];
    for (const object of page.objects) {
      const id = object.key.slice(SHARE_PREFIX.length);
      const record = fromMetadata(id, object.customMetadata);
      if (record && !isExpired(record, now)) continue;
      removals.push({ id, hasPasscode: Boolean(record?.passcode) });
    }
    await removeAll(env, removals);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
}

export async function putReport(env: ShareEnv, id: string, reason: string, now: number) {
  const key = `reports/${id}/${now}-${randomToken(6)}`;
  const report = { id, reason, reportedAt: new Date(now).toISOString() };
  await env.SHARES.put(key, JSON.stringify(report), {
    httpMetadata: { contentType: 'application/json' },
  });
}
