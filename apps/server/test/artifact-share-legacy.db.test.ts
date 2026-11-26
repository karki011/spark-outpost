import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shareIdForToken } from '../src/artifacts/share-id.ts';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, ShareHarness, sharePath } from './artifact-share-support.ts';

const LEGACY_ID = 'Ab3_-Ab3_-Ab3_-Ab3_-Ab';
const LEGACY_TOKEN = 'L'.repeat(43);
const BODY = { expiresInDays: 1, passcode: false };

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

async function legacyLiveShare(): Promise<string> {
  const id = await s.publish('html', HTML);
  const made = await s.client().send('post', sharePath(id), BODY).expect(201);
  const shareId = made.body.share.shareId as string;
  const stored = s.fake.shares.get(shareId)!;
  s.fake.shares.delete(shareId);
  s.fake.shares.set(LEGACY_ID, { ...stored, id: LEGACY_ID, deleteToken: LEGACY_TOKEN });
  await s.t.db.query('UPDATE artifact_page_shares SET share_id = $1, url = $2', [
    LEGACY_ID,
    `${s.origin}/a/${LEGACY_ID}`,
  ]);
  await s.secrets.delete(shareSecret(shareId));
  await s.secrets.set(shareSecret(LEGACY_ID), LEGACY_TOKEN);
  s.fake.posts.length = 0;
  return id;
}

async function legacyPendingRow(): Promise<string> {
  const id = await s.publish('html', HTML);
  await s.t.db.query(
    `INSERT INTO artifact_page_shares
       (share_id, artifact_id, version, state, url, expires_at, has_passcode, created_at)
     VALUES ($1, $2, 1, 'pending', $3, now() + interval '7 days', false,
             now() - interval '2 minutes')`,
    [LEGACY_ID, id, `${s.origin}/a/${LEGACY_ID}`],
  );
  await s.secrets.set(shareSecret(LEGACY_ID), LEGACY_TOKEN);
  return id;
}

const LEGACY_DELETE = { id: LEGACY_ID, authorization: `Bearer ${LEGACY_TOKEN}` };

describe('shares made before an id came from its delete key', { timeout: 30_000 }, () => {
  it('has an id its key does not give', () => {
    expect(shareIdForToken(LEGACY_TOKEN)).not.toBe(LEGACY_ID);
  });

  it('stops sharing a live one with its stored key', async () => {
    const id = await legacyLiveShare();
    const client = s.client();
    expect((await client.get(sharePath(id)).expect(200)).body.share.shareId).toBe(LEGACY_ID);

    await client.send('delete', sharePath(id)).expect(204);

    expect(s.fake.deletes).toEqual([LEGACY_DELETE]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(LEGACY_ID))).toBeNull();
  });

  it('takes a live orphan down in the sweep', async () => {
    await legacyLiveShare();
    await s.t.db.query('DELETE FROM artifact_page_versions');

    await s.sweep();

    expect(s.fake.deletes).toEqual([LEGACY_DELETE]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(LEGACY_ID))).toBeNull();
  });

  it('clears a pending row with nothing stored on a 404 and sends no upload', async () => {
    await legacyPendingRow();

    await s.sweep();

    expect(s.fake.deletes).toEqual([LEGACY_DELETE]);
    expect(s.fake.posts).toEqual([]);
    expect(s.fake.retired.has(LEGACY_ID)).toBe(false);
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(LEGACY_ID))).toBeNull();
  });

  it('shares again over a pending row with a fresh key and id, never the old pair', async () => {
    const id = await legacyPendingRow();

    const made = await s.client().send('post', sharePath(id), BODY).expect(201);

    expect(s.fake.deletes).toEqual([LEGACY_DELETE]);
    expect(s.fake.posts).toHaveLength(1);
    const sent = s.fake.posts[0]!;
    expect(sent.id).not.toBe(LEGACY_ID);
    expect(sent.deleteToken).not.toBe(LEGACY_TOKEN);
    expect(sent.id).toBe(shareIdForToken(sent.deleteToken));
    expect(made.body.share.shareId).toBe(sent.id);
    expect(await s.states()).toEqual(['live']);
    expect(await s.secrets.get(shareSecret(LEGACY_ID))).toBeNull();
    expect(await s.secrets.get(shareSecret(sent.id))).toBe(sent.deleteToken);
  });
});
