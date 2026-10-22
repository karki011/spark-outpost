import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import {
  chatKeptFolder,
  chatWorkFolder,
  ensureChatWorkFolder,
  isChatWorkFolder,
} from '../src/chat-files/folders.ts';
import { pruneChatFolders } from '../src/chat-files/prune.ts';
import { readInside, recordChatFiles } from '../src/chat-files/record.ts';
import { LeaseLostError } from '../src/persistence/run-events.ts';
import type { Lease } from '../src/persistence/jobs.ts';
import { listChatFiles } from '../src/chat-files/store.ts';
import { LOCAL_HEADERS, ORIGIN, testAppOptions } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';
import { openChat, sendMessage } from './turn-support.ts';
import { connectAgents } from './turn-worker.ts';

let t: TestDb;
let base: string;
let outside: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-chat-files-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'spark-outside-')));
  await connectAgents(t);
});

afterEach(async () => {
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const leases = new Map<string, Lease>();

async function leaseRun(runId: string): Promise<Lease> {
  const { rows } = await t.db.query<{ id: string; lease_token: string; attempts: number }>(
    `UPDATE jobs SET status = 'leased', attempts = attempts + 1, lease_token = $2,
       lease_expires_at = now() + interval '5 minutes'
     WHERE run_id = $1 RETURNING id, lease_token, attempts`,
    [runId, randomUUID()],
  );
  const row = rows[0]!;
  return { jobId: row.id, runId, token: row.lease_token, attempt: row.attempts };
}

async function chatWithRuns(count: number) {
  const conversationId = await openChat(t);
  const runIds: string[] = [];
  for (let index = 0; index < count; index++) {
    const runId = await sendMessage(t, conversationId, `turn ${index}`, { permission: 'do' });
    leases.set(runId, await leaseRun(runId));
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [runId]);
    runIds.push(runId);
  }
  const folder = await ensureChatWorkFolder(base, conversationId);
  return { conversationId, runIds, folder };
}

const record = (conversationId: string, runId: string) =>
  recordChatFiles({ db: t.db, base, conversationId, lease: leases.get(runId)! });

const keptCopies = async (conversationId: string) =>
  (await readdir(chatKeptFolder(base, conversationId)).catch(() => [])).length;

const client = () => request(createApp({ ...testAppOptions(t), chatFolders: base }));

describe('the files a chat turn makes', () => {
  it('keeps new and changed files for the turn that made them, once', async () => {
    const { conversationId, runIds, folder } = await chatWithRuns(3);
    await writeFile(join(folder, 'cpi.csv'), 'a,b\n');
    await mkdir(join(folder, 'out'));
    await writeFile(join(folder, 'out', 'chart.png'), Buffer.from([137, 80, 78, 71]));

    expect(await record(conversationId, runIds[0]!)).toBe(2);
    expect(await record(conversationId, runIds[1]!)).toBe(0);
    await writeFile(join(folder, 'cpi.csv'), 'a,b\n1,2\n');
    expect(await record(conversationId, runIds[2]!)).toBe(1);

    const files = await listChatFiles(t.db, conversationId);
    expect(files.map((file) => [file.path, file.runId, file.kind])).toEqual([
      ['cpi.csv', runIds[0], 'file'],
      ['out/chart.png', runIds[0], 'image'],
      ['cpi.csv', runIds[2], 'file'],
    ]);
  });

  it('leaves out links, hidden folders and installed packages', async () => {
    const { conversationId, runIds, folder } = await chatWithRuns(1);
    await writeFile(join(outside, 'credentials'), 'secret');
    await symlink(join(outside, 'credentials'), join(folder, 'linked.txt'));
    await mkdir(join(folder, '.cache'));
    await writeFile(join(folder, '.cache', 'x.txt'), 'x');
    await mkdir(join(folder, 'node_modules'));
    await writeFile(join(folder, 'node_modules', 'y.js'), 'y');
    await writeFile(join(folder, 'kept.md'), '# kept');

    expect(await record(conversationId, runIds[0]!)).toBe(1);
    expect((await listChatFiles(t.db, conversationId)).map((file) => file.path)).toEqual([
      'kept.md',
    ]);
  });

  it('serves a kept copy as plain text or a download, never as a page', async () => {
    const { conversationId, runIds, folder } = await chatWithRuns(1);
    await writeFile(join(folder, 'page.html'), '<script>alert(1)</script>');
    await writeFile(join(folder, 'chart.png'), Buffer.from([137, 80, 78, 71]));
    await record(conversationId, runIds[0]!);
    await writeFile(join(folder, 'page.html'), 'changed after the turn');
    const files = await listChatFiles(t.db, conversationId);
    const page = files.find((file) => file.name === 'page.html')!;
    const chart = files.find((file) => file.name === 'chart.png')!;

    const shown = await client().get(`/api/chat-files/${page.id}/content`).set(LOCAL_HEADERS);
    expect(shown.status).toBe(200);
    expect(shown.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(shown.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(shown.headers['x-content-type-options']).toBe('nosniff');
    expect(shown.text).toBe('<script>alert(1)</script>');

    const saved = await client()
      .get(`/api/chat-files/${page.id}/content?download=1`)
      .set(LOCAL_HEADERS);
    expect(saved.headers['content-disposition']).toMatch(/^attachment; filename="page.html"/);
    expect(saved.headers['content-type']).toBe('application/octet-stream');

    const image = await client().get(`/api/chat-files/${chart.id}/content`).set(LOCAL_HEADERS);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['content-disposition']).toMatch(/^inline/);

    const missing = await client()
      .get('/api/chat-files/00000000-0000-4000-8000-000000000000/content')
      .set(LOCAL_HEADERS);
    expect(missing.status).toBe(404);
  });

  it('removes the chat’s folder with the chat, and folders of chats already gone', async () => {
    const kept = await chatWithRuns(1);
    const removed = await chatWithRuns(1);
    const orphan = await ensureChatWorkFolder(base, '11111111-1111-4111-8111-111111111111');

    const response = await client()
      .delete(`/api/conversations/${removed.conversationId}`)
      .set(LOCAL_HEADERS)
      .set('Origin', ORIGIN)
      .send({});

    expect(response.status).toBe(204);
    expect(existsSync(removed.folder)).toBe(false);
    expect(await pruneChatFolders(t.db, base)).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(kept.folder)).toBe(true);
  });

  it('knows its own folders by place, not by name', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(isChatWorkFolder(base, chatWorkFolder(base, id))).toBe(true);
    expect(isChatWorkFolder(base, join(base, id))).toBe(false);
    expect(isChatWorkFolder(base, join(outside, id, 'work'))).toBe(false);
    expect(() => chatWorkFolder(base, '../escape')).toThrow();
  });
});

describe('keeping files safely', () => {
  it('sees a rewrite that keeps the size and the modified time', async () => {
    const { conversationId, runIds, folder } = await chatWithRuns(2);
    const file = join(folder, 'cpi.csv');
    await writeFile(file, 'a,b\n1,2\n');
    expect(await record(conversationId, runIds[0]!)).toBe(1);
    const before = await stat(file);
    await writeFile(file, 'a,b\n3,4\n');
    await utimes(file, before.atime, before.mtime);

    expect(await record(conversationId, runIds[1]!)).toBe(1);
    expect((await listChatFiles(t.db, conversationId)).map((kept) => kept.runId)).toEqual([
      runIds[0],
      runIds[1],
    ]);
  });

  it('keeps nothing once the turn’s lease is lost', async () => {
    const { conversationId, runIds, folder } = await chatWithRuns(1);
    await writeFile(join(folder, 'cpi.csv'), 'a,b\n');
    await t.db.query(`UPDATE jobs SET lease_token = $2 WHERE run_id = $1`, [
      runIds[0],
      randomUUID(),
    ]);

    await expect(record(conversationId, runIds[0]!)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await listChatFiles(t.db, conversationId)).toEqual([]);
    expect(await keptCopies(conversationId)).toBe(0);
  });

  it('removes the copy of a file it could not record and still keeps the rest', async () => {
    const { conversationId, runIds, folder } = await chatWithRuns(1);
    await writeFile(join(folder, 'a.txt'), 'a');
    await writeFile(join(folder, 'bad.txt'), 'b');
    await writeFile(join(folder, 'c.txt'), 'c');
    await t.db.query(`
      CREATE FUNCTION refuse_bad() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.path = 'bad.txt' THEN RAISE EXCEPTION 'refused'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER refuse_bad BEFORE INSERT ON chat_files
        FOR EACH ROW EXECUTE FUNCTION refuse_bad();`);

    await expect(record(conversationId, runIds[0]!)).rejects.toThrow('could not be kept');
    expect((await listChatFiles(t.db, conversationId)).map((file) => file.path)).toEqual([
      'a.txt',
      'c.txt',
    ]);
    expect(await keptCopies(conversationId)).toBe(2);
  });

  it('never reads through a folder swapped for a link to somewhere else', async () => {
    const { folder } = await chatWithRuns(1);
    const work = await realpath(folder);
    await mkdir(join(outside, 'sub'));
    await writeFile(join(outside, 'sub', 'secret.txt'), 'secret');
    await symlink(join(outside, 'sub'), join(work, 'sub'));

    expect(await readInside(work, 'sub/secret.txt')).toBeNull();
    await mkdir(join(work, 'real'));
    await writeFile(join(work, 'real', 'ok.txt'), 'ok');
    expect((await readInside(work, 'real/ok.txt'))?.data.toString()).toBe('ok');
  });
});
