import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, ShareHarness, sharePath } from './artifact-share-support.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

async function sharedPage(): Promise<{ id: string; shareId: string }> {
  const id = await s.publish('html', HTML);
  const made = await s
    .client()
    .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
    .expect(201);
  return { id, shareId: made.body.share.shareId as string };
}

async function unshareEntries(): Promise<number> {
  const { rows } = await s.t.db.query(
    "SELECT 1 FROM run_protocol_log WHERE method = 'spark/artifact_unshare'",
  );
  return rows.length;
}

async function stillShared(id: string, shareId: string): Promise<void> {
  const status = await s.client().get(sharePath(id)).expect(200);
  expect(status.body.share.shareId).toBe(shareId);
  expect(s.fake.shares.has(shareId)).toBe(true);
  expect(await unshareEntries()).toBe(0);
}

describe('stop sharing when the page cannot be removed', { timeout: 30_000 }, () => {
  it('says Spark can’t remove the page when its key is gone, and keeps showing the link', async () => {
    const { id, shareId } = await sharedPage();
    await s.secrets.delete(shareSecret(shareId));
    const stop = await s.client().send('delete', sharePath(id)).expect(409);
    expect(stop.body.error).toMatch(/^Spark can’t remove this page .* It ends on .+\.$/);
    expect(stop.body.error).not.toContain('\n');
    expect(s.fake.deletes).toEqual([]);
    await stillShared(id, shareId);
  });

  it('keeps the link when the service answers with an error', async () => {
    const { id, shareId } = await sharedPage();
    const failing: typeof fetch = async (url, init) =>
      init?.method === 'DELETE' ? new Response(null, { status: 500 }) : fetch(url, init);
    const stop = await s
      .client(s.service({ fetch: failing }))
      .send('delete', sharePath(id))
      .expect(502);
    expect(stop.body.error).toMatch(/still open/);
    await stillShared(id, shareId);
    expect(await s.secrets.get(shareSecret(shareId))).not.toBeNull();
  });

  it('keeps the link when the service cannot be reached', async () => {
    const { id, shareId } = await sharedPage();
    const unreachable: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const stop = await s
      .client(s.service({ fetch: unreachable }))
      .send('delete', sharePath(id))
      .expect(502);
    expect(stop.body.error).toMatch(/couldn't reach/);
    await stillShared(id, shareId);
  });
});
