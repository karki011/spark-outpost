import { randomBytes, randomInt } from 'node:crypto';
import {
  ARTIFACT_SHARE_DELETE_TOKEN_BYTES,
  ARTIFACT_SHARE_ID_BYTES,
  ARTIFACT_SHARE_PASSCODE_ALPHABET,
  ARTIFACT_SHARE_PASSCODE_LENGTH,
  type ArtifactShare,
  type ArtifactShareDays,
  type ArtifactShareTheme,
  type CreatedArtifactShare,
} from '@spark-outpost/contracts';
import { insertFinishedRunEntriesIn } from '../persistence/audit-log.ts';
import { withTransaction, type Db, type DbClient, type Queryable } from '../persistence/db.ts';
import { shareSecret, type SecretStore } from '../setup/secrets.ts';
import { readVersionFile } from './files.ts';
import { shareDocument } from './share-document.ts';
import {
  removeShare,
  sharePageUrl,
  ShareServiceError,
  ShareUnansweredError,
  uploadShare,
  type SharedPage,
  type ShareService,
} from './share-service.ts';
import {
  deleteShare,
  heldShare,
  insertPendingShare,
  liveShare,
  lockPendingShare,
  markShareLive,
  removeExpiredShare,
  type PendingShare,
} from './share-store.ts';
import type { StoredVersion } from './store.ts';

export interface StopDeps {
  db: Db;
  secrets: SecretStore;
  service: ShareService;
}

export interface ShareDeps extends StopDeps {
  origin: string;
  chatFolders: string;
}

export interface ShareChoice {
  expiresInDays: ArtifactShareDays;
  passcode: boolean;
  theme?: ArtifactShareTheme | undefined;
}

export class ShareRefusedError extends Error {}

export class AlreadySharedError extends Error {
  constructor(readonly share: ArtifactShare) {
    super(
      'This version is already shared. Stop sharing to make a new link with different settings.',
    );
  }
}

class ShareKeyMissingError extends Error {}

const PENDING_MARGIN_MS = 60 * 60_000;
const DAY_MS = 86_400_000;
const STILL_REMOVING =
  'Spark is still removing an earlier try to share this version. Try again in a minute.';
const NOT_SAVED = 'The link could not be saved. Try again.';

function newPasscode(): string {
  const alphabet = ARTIFACT_SHARE_PASSCODE_ALPHABET;
  let code = '';
  for (let index = 0; index < ARTIFACT_SHARE_PASSCODE_LENGTH; index++) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

async function auditShare(
  client: DbClient,
  stored: StoredVersion,
  method: 'spark/artifact_share' | 'spark/artifact_unshare',
  share: ArtifactShare,
): Promise<void> {
  const { rows } = await client.query<{ run_id: string | null }>(
    `SELECT COALESCE(v.run_id, (SELECT r.id FROM runs r WHERE r.conversation_id = $3
                                ORDER BY r.created_at DESC LIMIT 1)) AS run_id
     FROM artifact_page_versions v WHERE v.artifact_id = $1 AND v.version = $2`,
    [stored.artifactId, stored.version, stored.conversationId],
  );
  const runId = rows[0]?.run_id;
  if (!runId) return;
  const payload = {
    artifactId: stored.artifactId,
    version: stored.version,
    bytes: stored.bytes,
    sha256: stored.sha256,
    shareId: share.shareId,
    expiresAt: share.expiresAt,
    hasPasscode: share.hasPasscode,
  };
  await insertFinishedRunEntriesIn(client, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'notification',
      method,
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

interface TakedownDeps {
  db: Queryable;
  secrets: SecretStore;
  service: ShareService;
}

async function removeRemote(
  deps: TakedownDeps,
  page: SharedPage,
  trustMissing: boolean,
): Promise<void> {
  const token = await deps.secrets.get(shareSecret(page.shareId));
  if (!token) throw new ShareKeyMissingError(`No delete key for shared page ${page.shareId}`);
  const answer = await removeShare(deps.service, page, token);
  if (answer === 404 && !trustMissing) {
    throw new ShareServiceError('The share service could not confirm the page is gone.');
  }
}

export async function takeDown(
  deps: TakedownDeps,
  page: SharedPage,
  trustMissing = true,
): Promise<void> {
  await removeRemote(deps, page, trustMissing);
  await deleteShare(deps.db, page.shareId);
  await deps.secrets.delete(shareSecret(page.shareId));
}

export async function takeDownPending(
  deps: TakedownDeps & { db: Db },
  shareId: string,
): Promise<boolean> {
  const claimed = await withTransaction(deps.db, async (client) => {
    const url = await lockPendingShare(client, shareId);
    if (url === null) return false;
    await removeRemote(deps, { shareId, url }, true);
    await deleteShare(client, shareId);
    return true;
  });
  if (claimed) await deps.secrets.delete(shareSecret(shareId));
  return claimed;
}

async function dropExpired(deps: StopDeps, stored: StoredVersion): Promise<void> {
  const expired = await removeExpiredShare(deps.db, stored.artifactId, stored.version);
  if (expired) await deps.secrets.delete(shareSecret(expired));
}

async function clearHeld(deps: ShareDeps, stored: StoredVersion): Promise<void> {
  const held = await heldShare(deps.db, stored.artifactId, stored.version);
  if (!held) return;
  if (held.live) {
    const share = await liveShare(deps.db, stored.artifactId, stored.version);
    if (share) throw new AlreadySharedError(share);
    return;
  }
  if (!held.stale) throw new ShareRefusedError(STILL_REMOVING);
  const cleared = await takeDownPending(deps, held.shareId).catch(() => {
    throw new ShareRefusedError(STILL_REMOVING);
  });
  if (!cleared) await clearHeld(deps, stored);
}

async function claim(deps: ShareDeps, stored: StoredVersion, pending: PendingShare) {
  if (await insertPendingShare(deps.db, pending)) return;
  await clearHeld(deps, stored);
  if (await insertPendingShare(deps.db, pending)) return;
  throw new ShareRefusedError(NOT_SAVED);
}

async function upload(
  deps: ShareDeps,
  stored: StoredVersion,
  choice: ShareChoice,
): Promise<CreatedArtifactShare> {
  await dropExpired(deps, stored);
  const text = await readVersionFile(deps.chatFolders, stored);
  if (text === null) throw new ShareRefusedError('This version could not be read.');
  const html = shareDocument(stored.kind, stored.title, text);
  const passcode = choice.passcode ? newPasscode() : null;
  const id = randomBytes(ARTIFACT_SHARE_ID_BYTES).toString('base64url');
  const deleteToken = randomBytes(ARTIFACT_SHARE_DELETE_TOKEN_BYTES).toString('base64url');
  const page = { shareId: id, url: sharePageUrl(deps.origin, id) };
  try {
    await deps.secrets.set(shareSecret(id), deleteToken);
  } catch {
    throw new ShareRefusedError('Spark couldn’t save the link in your keychain. Try again.');
  }
  await claim(deps, stored, {
    shareId: id,
    artifactId: stored.artifactId,
    version: stored.version,
    url: page.url,
    expiresAt: new Date(Date.now() + choice.expiresInDays * DAY_MS + PENDING_MARGIN_MS),
    hasPasscode: passcode !== null,
  }).catch(async (error: unknown) => {
    await deps.secrets.delete(shareSecret(id)).catch(() => undefined);
    throw error;
  });
  try {
    const expiresAt = await uploadShare(deps.service, deps.origin, {
      id,
      deleteToken,
      title: stored.title,
      html,
      expiresInDays: choice.expiresInDays,
      passcode,
      theme: choice.theme ?? null,
    });
    const share = await withTransaction(deps.db, async (client) => {
      const live = await markShareLive(client, id, expiresAt);
      if (!live) throw new ShareRefusedError(NOT_SAVED);
      await auditShare(client, stored, 'spark/artifact_share', live);
      return live;
    });
    return { share, passcode };
  } catch (error) {
    const trustMissing = !(error instanceof ShareUnansweredError);
    await takeDown(deps, page, trustMissing).catch(() => undefined);
    throw error;
  }
}

interface RunningShare {
  choice: ShareChoice;
  created: Promise<CreatedArtifactShare>;
}

const inFlight = new Map<string, RunningShare>();

async function join(running: RunningShare, choice: ShareChoice): Promise<CreatedArtifactShare> {
  const same =
    running.choice.expiresInDays === choice.expiresInDays &&
    running.choice.passcode === choice.passcode;
  if (same) return running.created;
  const { share } = await running.created;
  throw new AlreadySharedError(share);
}

export async function createShare(
  deps: ShareDeps,
  stored: StoredVersion,
  choice: ShareChoice,
): Promise<CreatedArtifactShare> {
  const key = `${stored.artifactId}:${stored.version}`;
  const existing = await liveShare(deps.db, stored.artifactId, stored.version);
  const running = inFlight.get(key);
  if (running) return join(running, choice);
  if (existing) throw new AlreadySharedError(existing);
  const created = upload(deps, stored, choice);
  inFlight.set(key, { choice, created });
  try {
    return await created;
  } finally {
    inFlight.delete(key);
  }
}

function endDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long' });
}

export async function stopShare(deps: StopDeps, stored: StoredVersion): Promise<boolean> {
  const share = await liveShare(deps.db, stored.artifactId, stored.version);
  if (!share) {
    await dropExpired(deps, stored);
    return false;
  }
  try {
    await removeRemote(deps, share, true);
  } catch (error) {
    if (!(error instanceof ShareKeyMissingError)) throw error;
    throw new ShareRefusedError(
      `Spark can’t remove this page because its key is missing from your keychain. It ends on ${endDate(share.expiresAt)}.`,
    );
  }
  await withTransaction(deps.db, async (client) => {
    await deleteShare(client, share.shareId);
    await auditShare(client, stored, 'spark/artifact_unshare', share);
  });
  await deps.secrets.delete(shareSecret(share.shareId));
  return true;
}
