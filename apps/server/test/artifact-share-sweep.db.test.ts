import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneOldRows } from '../src/api/startup-prune.ts';
import { shareSweeper } from '../src/artifacts/share-sweep.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, ShareHarness, sharePath } from './artifact-share-support.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

async function shared(): Promise<{ id: string; shareId: string }> {
  const id = await s.publish('html', HTML);
  const made = await s
    .client()
    .send('post', sharePath(id), { expiresInDays: 1, passcode: false })
    .expect(201);
  return { id, shareId: made.body.share.shareId as string };
}

async function deleteChat(): Promise<void> {
  await deleteConversation(s.t.db, s.t.workspaceId, s.artifacts.chat.conversationId);
}

const failingDeletes: typeof fetch = async (url, init) =>
  init?.method === 'DELETE' ? new Response(null, { status: 500 }) : fetch(url, init);

describe('sweeping shared pages', { timeout: 30_000 }, () => {
  it('takes down the page of a chat removed outside the delete route', async () => {
    const { shareId } = await shared();
    const token = s.fake.shares.get(shareId)!.deleteToken;
    await deleteChat();
    expect(await s.rows('artifact_page_shares')).toContain(shareId);

    await s.sweep();

    expect(s.fake.deletes).toEqual([{ id: shareId, authorization: `Bearer ${token}` }]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.rows('artifact_page_shares')).toBe('[]');
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });

  it('keeps the row and token when the takedown fails, and finishes on the next sweep', async () => {
    const { shareId } = await shared();
    await deleteChat();

    await s.sweep(s.service({ fetch: failingDeletes }));
    expect(await s.rows('artifact_page_shares')).toContain(shareId);
    expect(await s.secrets.get(shareSecret(shareId))).not.toBeNull();
    expect(s.fake.shares.size).toBe(1);

    await s.sweep();
    expect(s.fake.shares.size).toBe(0);
    expect(await s.rows('artifact_page_shares')).toBe('[]');
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });

  it('keeps an orphan whose key is gone until its end date', async () => {
    const { shareId } = await shared();
    await s.secrets.delete(shareSecret(shareId));
    await deleteChat();

    await s.sweep();
    expect(s.fake.deletes).toEqual([]);
    expect(await s.rows('artifact_page_shares')).toContain(shareId);

    await s.t.db.query("UPDATE artifact_page_shares SET expires_at = now() - interval '1 minute'");
    await s.sweep();
    expect(await s.rows('artifact_page_shares')).toBe('[]');
  });

  it('forgets expired links and their tokens without calling the service', async () => {
    const kept = await shared();
    await s.t.db.query("UPDATE artifact_page_shares SET expires_at = now() - interval '1 minute'");
    await deleteChat();

    await s.sweep(null);

    expect(s.fake.deletes).toEqual([]);
    expect(await s.rows('artifact_page_shares')).toBe('[]');
    expect(await s.secrets.get(shareSecret(kept.shareId))).toBeNull();
  });

  it('leaves live links of live artifacts alone, and skips takedowns with no service', async () => {
    const live = await shared();
    await s.sweep();
    expect(await s.rows('artifact_page_shares')).toContain(live.shareId);

    await deleteChat();
    await s.sweep(null);
    expect(s.fake.deletes).toEqual([]);
    expect(await s.rows('artifact_page_shares')).toContain(live.shareId);
    expect(await s.secrets.get(shareSecret(live.shareId))).not.toBeNull();
  });

  it('runs with the hourly prune, once at a time and once more when asked meanwhile', async () => {
    const { shareId } = await shared();
    await deleteChat();
    const sweep = shareSweeper({ db: s.t.db, secrets: s.secrets, service: s.service() });

    await Promise.all([
      pruneOldRows({
        db: s.t.db,
        workspaceId: s.t.workspaceId,
        auditRetentionDays: 90,
        sweepShares: sweep,
      }),
      sweep(),
      sweep(),
    ]);

    expect(s.fake.deletes.map((entry) => entry.id)).toEqual([shareId]);
    expect(await s.rows('artifact_page_shares')).toBe('[]');
  });
});
