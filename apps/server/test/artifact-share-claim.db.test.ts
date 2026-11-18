import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shareSecret } from '../src/setup/secrets.ts';
import { deleteConversation } from '../src/persistence/conversation-actions.ts';
import { HTML, ShareHarness, sharePath, untilAborted } from './artifact-share-support.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

const BODY = { expiresInDays: 7, passcode: false };
const OTHER_WORKER = 'https://other-worker.example';

const storedThenTimedOut: typeof fetch = async (url, init) => {
  if (init?.method === 'POST') await fetch(url, { ...init, signal: null });
  return untilAborted(init);
};

function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

function held(method: string, when: 'before' | 'after') {
  const reached = gate();
  const release = gate();
  const fetchHeld: typeof fetch = async (url, init) => {
    if (init?.method !== method) return fetch(url, init);
    const answer = when === 'after' ? await fetch(url, init) : null;
    reached.open();
    await release.opened;
    return answer ?? fetch(url, init);
  };
  return { fetch: fetchHeld, reached: reached.opened, release: release.open };
}

async function pendingAfterLostAnswer(): Promise<{ id: string; shareId: string }> {
  const id = await s.publish('html', HTML);
  await s
    .client(s.service({ fetch: storedThenTimedOut, timeoutMs: 300 }))
    .send('post', sharePath(id), BODY)
    .expect(502);
  return { id, shareId: s.fake.posts[0]!.id };
}

describe('a pending share the sweep and its own create both reach', { timeout: 30_000 }, () => {
  it('leaves a share alone when its create finishes while the sweep waits for it', async () => {
    const { shareId } = await pendingAfterLostAnswer();
    await s.makePendingStale();
    const finishing = await s.t.db.connect();
    try {
      await finishing.query('BEGIN');
      await finishing.query("UPDATE artifact_page_shares SET state = 'live' WHERE share_id = $1", [
        shareId,
      ]);
      const sweeping = s.sweep();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(s.fake.deletes).toEqual([]);
      await finishing.query('COMMIT');
      await sweeping;
    } finally {
      finishing.release();
    }

    expect(s.fake.deletes).toEqual([]);
    expect(await s.states()).toEqual(['live']);
    expect(s.fake.shares.has(shareId)).toBe(true);
    expect(await s.secrets.get(shareSecret(shareId))).not.toBeNull();
  });

  it('never returns a link for a create whose row the sweep claimed first', async () => {
    const id = await s.publish('html', HTML);
    const slow = held('POST', 'after');
    const creating = s.client(s.service({ fetch: slow.fetch })).send('post', sharePath(id), BODY);
    const answered = creating.then((response) => response);
    await slow.reached;
    const shareId = s.fake.posts[0]!.id;
    expect(s.fake.shares.has(shareId)).toBe(true);

    await s.makePendingStale();
    await s.sweep();
    expect(await s.states()).toEqual([]);
    expect(s.fake.shares.size).toBe(0);
    slow.release();

    const response = await answered;
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/could not be saved/);
    expect(response.body.share).toBeUndefined();
    expect(await s.states()).toEqual([]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
    const status = await s.client().get(sharePath(id)).expect(200);
    expect(status.body.share).toBeNull();
  });

  it('holds a finishing create back until the sweep has removed the page', async () => {
    const { shareId } = await pendingAfterLostAnswer();
    await s.makePendingStale();
    const slow = held('DELETE', 'before');
    const sweeping = s.sweep(s.service({ fetch: slow.fetch }));
    await slow.reached;

    const finishing = s.t.db.query(
      "UPDATE artifact_page_shares SET state = 'live' WHERE share_id = $1 AND state = 'pending'",
      [shareId],
    );
    const early = await Promise.race([
      finishing.then(() => 'finished'),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 300)),
    ]);
    expect(early).toBe('waiting');
    slow.release();
    await sweeping;

    expect((await finishing).rowCount).toBe(0);
    expect(await s.states()).toEqual([]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });

  it('refuses an upload that reaches the service after the sweep removed its id', async () => {
    const id = await s.publish('html', HTML);
    const slow = held('POST', 'before');
    const answered = s
      .client(s.service({ fetch: slow.fetch }))
      .send('post', sharePath(id), BODY)
      .then((response) => response);
    await slow.reached;
    await s.makePendingStale();
    await s.sweep();
    expect(s.fake.deletes).toHaveLength(1);
    slow.release();

    expect((await answered).status).toBe(502);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.states()).toEqual([]);
  });
});

describe('a share made through another share service', { timeout: 30_000 }, () => {
  async function shared(): Promise<{ id: string; shareId: string }> {
    const id = await s.publish('html', HTML);
    const made = await s.client().send('post', sharePath(id), BODY).expect(201);
    return { id, shareId: made.body.share.shareId as string };
  }

  function recording() {
    const deletes: string[] = [];
    const recorded: typeof fetch = async (url, init) => {
      if (init?.method === 'DELETE') deletes.push(String(url));
      return fetch(url, init);
    };
    return { deletes, fetch: recorded };
  }

  it.each([
    ['another service is configured', OTHER_WORKER],
    ['no service is configured', null],
  ])('stops sharing at the service that holds the page when %s', async (_name, origin) => {
    const { id, shareId } = await shared();
    const seen = recording();
    const client = s.client(s.service({ origin, fetch: seen.fetch }));

    await client.send('delete', sharePath(id)).expect(204);

    expect(seen.deletes).toEqual([`${s.origin}/v1/shares/${shareId}`]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.states()).toEqual([]);
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });

  it('offers no new link with no service configured, and still shows the old one', async () => {
    const { id, shareId } = await shared();
    const client = s.client(s.service({ origin: null }));

    const status = await client.get(sharePath(id)).expect(200);
    expect(status.body).toMatchObject({ available: false, share: { shareId } });
    await client.send('post', sharePath(id), BODY).expect(503);
    expect(s.fake.shares.has(shareId)).toBe(true);
  });

  it.each([
    ['another service is configured', OTHER_WORKER],
    ['no service is configured', null],
  ])('sweeps an orphan at the service that holds it when %s', async (_name, origin) => {
    const { shareId } = await shared();
    await deleteConversation(s.t.db, s.t.workspaceId, s.artifacts.chat.conversationId);
    const seen = recording();

    await s.sweep(s.service({ origin, fetch: seen.fetch }));

    expect(seen.deletes).toEqual([`${s.origin}/v1/shares/${shareId}`]);
    expect(s.fake.shares.size).toBe(0);
    expect(await s.states()).toEqual([]);
  });

  it('keeps the row and key when the stored link names no usable service', async () => {
    const { id, shareId } = await shared();
    await s.t.db.query("UPDATE artifact_page_shares SET url = 'http://example.com/a/x'");
    const seen = recording();

    const stop = await s
      .client(s.service({ fetch: seen.fetch }))
      .send('delete', sharePath(id))
      .expect(502);

    expect(stop.body.error).toMatch(/can’t tell which share service/);
    expect(seen.deletes).toEqual([]);
    expect(await s.states()).toEqual(['live']);
    expect(await s.secrets.get(shareSecret(shareId))).not.toBeNull();
  });
});
