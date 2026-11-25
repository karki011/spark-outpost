import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_SHARE_DELETE_TOKEN_PATTERN,
  ARTIFACT_SHARE_ID_PATTERN,
} from '@spark-outpost/contracts';
import { sha256Of } from '../src/artifacts/files.ts';
import { chatWorkFolder } from '../src/chat-files/folders.ts';
import { shareIdForToken } from '../src/artifacts/share-id.ts';
import { shareSecret } from '../src/setup/secrets.ts';
import { HTML, PASSCODE, ShareHarness, sharePath } from './artifact-share-support.ts';

let s: ShareHarness;

beforeEach(async () => {
  s = await ShareHarness.create();
});

afterEach(async () => {
  await s.close();
});

async function auditEntries(method: string) {
  const { rows } = await s.t.db.query<{ payload: Record<string, unknown> }>(
    'SELECT payload FROM run_protocol_log WHERE method = $1 ORDER BY seq',
    [method],
  );
  return rows.map((row) => row.payload);
}

describe('sharing an artifact', { timeout: 30_000 }, () => {
  it('uploads the stored HTML as is, with only the documented fields, and records it', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    expect((await client.get(sharePath(id)).expect(200)).body).toEqual({
      available: true,
      share: null,
    });

    const created = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(201);

    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body.passcode).toBeNull();
    const [sent] = s.fake.posts;
    expect(sent).toMatchObject({ title: 'Deploy failures', html: HTML, expiresInDays: 7 });
    expect(sent!.keys).toEqual(['deleteToken', 'expiresInDays', 'html', 'id', 'title']);
    expect(sent!.id).toMatch(ARTIFACT_SHARE_ID_PATTERN);
    expect(sent!.deleteToken).toMatch(ARTIFACT_SHARE_DELETE_TOKEN_PATTERN);
    expect(sent!.id).toBe(shareIdForToken(sent!.deleteToken));
    expect(sent!.headers.authorization).toBeUndefined();
    expect(sent!.headers.cookie).toBeUndefined();
    const share = created.body.share;
    expect(share).toMatchObject({ shareId: sent!.id, version: 1, hasPasscode: false });
    expect(share.url).toBe(`${s.origin}/a/${share.shareId}`);
    const days = (Date.parse(share.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    expect((await client.get(sharePath(id)).expect(200)).body.share).toEqual(share);
    const [audit] = await auditEntries('spark/artifact_share');
    expect(audit).toEqual({
      artifactId: id,
      version: 1,
      bytes: Buffer.byteLength(HTML),
      sha256: sha256Of(HTML),
      shareId: share.shareId,
      expiresAt: share.expiresAt,
      hasPasscode: false,
    });
    expect(JSON.stringify(audit)).not.toContain(share.url);
    expect(await s.rows('artifact_page_shares')).not.toContain(
      s.fake.shares.get(share.shareId)!.deleteToken,
    );
    expect(await s.secrets.get(shareSecret(share.shareId))).toBe(
      s.fake.shares.get(share.shareId)!.deleteToken,
    );
  });

  it('sends the theme it was given and refuses one that is not plain colours', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const theme = {
      scheme: 'light',
      bg: '#f6f1ed',
      card: '#fffdfb',
      text: '#241a13',
      muted: '#614a3b',
      line: '#8f8378',
      accent: '#b34f00',
      accentInk: '#ffffff',
      ok: '#1f7335',
      bad: '#ba3129',
      strip: '#f5eae1',
    };

    await client
      .send('post', sharePath(id), {
        expiresInDays: 7,
        passcode: false,
        theme: { ...theme, accent: 'url(https://example.com)' },
      })
      .expect(400);
    expect(s.fake.posts).toHaveLength(0);

    await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false, theme })
      .expect(201);
    expect((s.fake.posts[0] as unknown as { theme: unknown }).theme).toEqual(theme);
  });

  it('makes a passcode once, sends it, and keeps it nowhere', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const created = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: true })
      .expect(201);

    const code = created.body.passcode as string;
    expect(code).toMatch(PASSCODE);
    expect(s.fake.posts[0]!.passcode).toBe(code);
    expect(created.body.share.hasPasscode).toBe(true);
    const status = await client.get(sharePath(id)).expect(200);
    expect(JSON.stringify(status.body)).not.toContain(code);
    expect(await s.rows('artifact_page_shares')).not.toContain(code);
    expect(await s.rows('run_protocol_log')).not.toContain(code);
    expect(await s.rows('run_events')).not.toContain(code);

    const again = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: true })
      .expect(409);
    expect(again.body).toEqual({
      error:
        'This version is already shared. Stop sharing to make a new link with different settings.',
      share: created.body.share,
    });
    expect(s.fake.posts).toHaveLength(1);
  });

  it('answers a second Share with other settings with the link that exists', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const first = await client
      .send('post', sharePath(id), { expiresInDays: 7, passcode: false })
      .expect(201);
    const second = await client
      .send('post', sharePath(id), { expiresInDays: 1, passcode: true })
      .expect(409);
    expect(second.body.share).toEqual(first.body.share);
    expect(second.body.passcode).toBeUndefined();
    expect(s.fake.posts).toHaveLength(1);
  });

  it('sends an SVG inside a page that shows it as an image, and refuses Markdown', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>';
    const id = await s.publish('svg', svg, 'Logo <b>');
    const client = s.client();
    await client.send('post', sharePath(id), { expiresInDays: 1, passcode: false }).expect(201);

    const html = s.fake.posts[0]!.html;
    const match =
      /<img src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)" alt="Logo &lt;b&gt;">/.exec(html);
    expect(Buffer.from(match![1]!, 'base64').toString('utf8')).toBe(svg);
    expect(html).not.toContain('<script');
    expect(html).toContain('<title>Logo &lt;b&gt;</title>');

    const notes = await s.publish('markdown', '# Plan');
    const refused = await client
      .send('post', sharePath(notes), { expiresInDays: 1, passcode: false })
      .expect(409);
    expect(refused.body.error).toMatch(/Markdown/);
    expect(s.fake.posts).toHaveLength(1);
  });

  it('uploads once when two identical creates arrive together, and both succeed', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const body = { expiresInDays: 7, passcode: true };
    s.fake.uploadMs = 300;
    const [first, second] = await Promise.all([
      client.send('post', sharePath(id), body),
      client.send('post', sharePath(id), body),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.body.passcode).toMatch(PASSCODE);
    expect(s.fake.posts).toHaveLength(1);
  });

  it('answers a different create that arrives during the upload with the new link', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    s.fake.uploadMs = 300;
    const answers = await Promise.all([
      client.send('post', sharePath(id), { expiresInDays: 7, passcode: true }),
      client.send('post', sharePath(id), { expiresInDays: 1, passcode: true }),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    const made = answers.find((answer) => answer.status === 201)!;
    const refused = answers.find((answer) => answer.status === 409)!;
    expect(made.body.passcode).toMatch(PASSCODE);
    expect(refused.body.share).toEqual(made.body.share);
    expect(refused.body).not.toHaveProperty('passcode');
    expect(JSON.stringify(refused.body)).not.toContain(made.body.passcode);
    expect(s.fake.posts).toHaveLength(1);
  });

  it('treats an expired link as not shared and makes a new one', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const old = await client.send('post', sharePath(id), { expiresInDays: 1, passcode: false });
    await s.t.db.query("UPDATE artifact_page_shares SET expires_at = now() - interval '1 minute'");
    expect((await client.get(sharePath(id)).expect(200)).body.share).toBeNull();

    const fresh = await client
      .send('post', sharePath(id), { expiresInDays: 1, passcode: false })
      .expect(201);
    expect(fresh.body.share.shareId).not.toBe(old.body.share.shareId);
    expect(s.fake.posts).toHaveLength(2);
    const { rows } = await s.t.db.query('SELECT share_id FROM artifact_page_shares');
    expect(rows).toEqual([{ share_id: fresh.body.share.shareId }]);
    expect(await s.secrets.get(shareSecret(old.body.share.shareId))).toBeNull();
  });

  it('stops sharing with the delete token, and still forgets a link the service lost', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const made = await client.send('post', sharePath(id), { expiresInDays: 7, passcode: false });
    const { shareId } = made.body.share;
    const token = s.fake.shares.get(shareId)!.deleteToken;

    await client.send('delete', sharePath(id)).expect(204);
    expect(s.fake.deletes).toEqual([{ id: shareId, authorization: `Bearer ${token}` }]);
    expect(s.fake.shares.size).toBe(0);
    expect((await client.get(sharePath(id)).expect(200)).body.share).toBeNull();
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
    const [audit] = await auditEntries('spark/artifact_unshare');
    expect(audit).toMatchObject({ artifactId: id, version: 1, shareId });
    expect(JSON.stringify(audit)).not.toContain(token);

    const again = await client.send('post', sharePath(id), { expiresInDays: 7, passcode: false });
    s.fake.shares.clear();
    await client.send('delete', sharePath(id)).expect(204);
    expect(s.fake.deletes.at(-1)!.id).toBe(again.body.share.shareId);
    expect((await client.get(sharePath(id)).expect(200)).body.share).toBeNull();
  });

  it('refuses to share a page that holds a value now in one of the chat’s secret files', async () => {
    const token = 'tok_live_4f9a8b7c6d5e4f3a2b1c';
    const id = await s.publish('html', `<!doctype html><p>${token}</p>`);
    const client = s.client();
    const work = chatWorkFolder(s.artifacts.base, s.artifacts.chat.conversationId);
    await mkdir(work, { recursive: true });
    await writeFile(join(work, '.env'), `API_TOKEN=${token}\n`);

    const refused = await client
      .send('post', sharePath(id), { expiresInDays: 1, passcode: false })
      .expect(409);

    expect(refused.body.error).toContain('holds a value from a secret file');
    expect(refused.body.error).not.toContain(token);
    expect(s.fake.posts).toHaveLength(0);
    expect(await s.states()).toEqual([]);

    await rm(join(work, '.env'));
    await client.send('post', sharePath(id), { expiresInDays: 1, passcode: false }).expect(201);
    expect(s.fake.posts).toHaveLength(1);
  });

  it('takes the shared page down when its chat is deleted', async () => {
    const id = await s.publish('html', HTML);
    const client = s.client();
    const made = await client.send('post', sharePath(id), { expiresInDays: 7, passcode: false });
    const { shareId } = made.body.share;

    await client
      .send('delete', `/api/conversations/${s.artifacts.chat.conversationId}`)
      .expect(204);

    await expect.poll(() => s.rows('artifact_page_shares')).toBe('[]');
    expect(s.fake.shares.size).toBe(0);
    expect(s.fake.deletes.map((entry) => entry.id)).toEqual([shareId]);
    expect(await s.secrets.get(shareSecret(shareId))).toBeNull();
  });
});
