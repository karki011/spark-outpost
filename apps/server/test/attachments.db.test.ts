import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Attachment, ConversationDetail } from '@spark-outpost/contracts';
import {
  getAttachmentContent,
  pruneUnlinkedAttachments,
  saveAttachment,
} from '../src/persistence/attachments.ts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { loadRunInput } from '../src/workflow/run-input.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, ORIGIN, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  worker = startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    pollMs: 20,
  });
  app = createTestApp(t);
});

afterEach(async () => {
  await worker.stop();
  await t.cleanup();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const upload = (data: Buffer | string, name: string, type: string) =>
  request(app)
    .post('/api/attachments')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .set('Content-Type', type)
    .set('X-File-Name', encodeURIComponent(name))
    .send(data);

const send = (conversationId: string, content: string, attachmentIds: string[]) =>
  request(app)
    .post(`/api/conversations/${conversationId}/messages`)
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .send({ id: randomUUID(), content, attachmentIds });

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

async function uploaded(data: Buffer | string, name: string, type: string): Promise<Attachment> {
  const response = await upload(data, name, type).expect(201);
  return response.body as Attachment;
}

async function foreignAttachment(content: string): Promise<Attachment> {
  const other = await t.db.query<{ id: string }>(
    `INSERT INTO workspaces (id, slug, name) VALUES ($1, 'other', 'Other') RETURNING id`,
    [randomUUID()],
  );
  return saveAttachment(t.db, other.rows[0]!.id, {
    name: 'x.txt',
    mediaType: 'text/plain',
    data: Buffer.from(content),
  });
}

async function messageCount(): Promise<number> {
  const { rows } = await t.db.query<{ count: string }>('SELECT count(*) FROM messages');
  return Number(rows[0]!.count);
}

describe('attachment uploads', () => {
  it('stores images and text and reports the classified attachment', async () => {
    const image = await uploaded(PNG, 'screen shot.png', 'image/png');
    expect(image).toEqual({
      id: expect.any(String),
      name: 'screen shot.png',
      mediaType: 'image/png',
      size: PNG.length,
      kind: 'image',
    });
    const json = await uploaded('{"a":1}', 'data.json', 'application/json');
    expect(json).toMatchObject({ kind: 'text', mediaType: 'application/json', size: 7 });
  });

  it('stores PDFs, spreadsheets and large text as files and reads them back', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0xff, 0x00, 0xfe])]);
    const stored = await uploaded(pdf, 'Q3 résumé.pdf', 'application/pdf');
    expect(stored).toEqual({
      id: expect.any(String),
      name: 'Q3 résumé.pdf',
      mediaType: 'application/pdf',
      size: pdf.length,
      kind: 'file',
    });
    const sheet = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]);
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(await uploaded(sheet, 'q3.xlsx', xlsx)).toMatchObject({ kind: 'file', mediaType: xlsx });
    const csv = Buffer.alloc(3 * 1024 * 1024, 'a,b\n');
    const big = await uploaded(csv, 'big.csv', 'text/csv');
    expect(big).toMatchObject({ kind: 'file', mediaType: 'text/csv', size: csv.length });
    const file = await getAttachmentContent(t.db, t.workspaceId, big.id);
    expect(file?.data.equals(csv)).toBe(true);
    const fake = await uploaded(Buffer.from([0xc3, 0x28]), 'fake.pdf', 'application/pdf');
    expect(fake.mediaType).toBe('application/octet-stream');
  });

  it('rejects empty files, secret names, a missing name header, and files over 20 MB', async () => {
    const empty = await upload(Buffer.alloc(0), 'a.bin', 'application/octet-stream').expect(400);
    expect(empty.body.error).toBe('The file is empty.');
    await upload(Buffer.from('A=1'), '.env', 'text/plain').expect(400);
    await request(app)
      .post('/api/attachments')
      .set(LOCAL_HEADERS)
      .set('Content-Type', 'text/plain')
      .send('hi')
      .expect(400);
    const limit = 20 * 1024 * 1024;
    await upload(Buffer.alloc(limit, 1), 'edge.bin', 'application/octet-stream').expect(201);
    const over = await upload(Buffer.alloc(limit + 1, 1), 'big.bin', 'application/zip').expect(413);
    expect(over.body.error).toBe('Files must be 20 MB or smaller.');
    await request(app)
      .post('/api/attachments')
      .set(LOCAL_HEADERS)
      .set('Origin', 'https://evil.example')
      .set('X-File-Name', 'a.txt')
      .send('hi')
      .expect(403);
  });

  it('always serves a file attachment as a download, never inline', async () => {
    const html = Buffer.from('<script>alert(1)</script>\u0000');
    const stored = await uploaded(html, 'page "x".html', 'text/html');
    expect(stored.kind).toBe('file');
    const response = await get(`/api/attachments/${stored.id}/content`).expect(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="page _x_.html"; filename*=UTF-8''page%20%22x%22.html`,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(Buffer.from(response.body).equals(html)).toBe(true);
  });

  it('still reads rows stored before files existed, and keeps other kinds refused', async () => {
    const image = await uploaded(PNG, 'a.png', 'image/png');
    const note = await uploaded(Buffer.from('hi'), 'a.txt', 'text/plain');
    const { rows } = await t.db.query<{ kind: string }>(
      'SELECT kind FROM attachments WHERE id = ANY($1::uuid[]) ORDER BY kind',
      [[image.id, note.id]],
    );
    expect(rows.map((row) => row.kind)).toEqual(['image', 'text']);
    await expect(
      t.db.query(
        `INSERT INTO attachments (id, workspace_id, name, media_type, kind, size, data)
         VALUES ($1, $2, 'x', 'x/y', 'archive', 1, $3)`,
        [randomUUID(), t.workspaceId, Buffer.from('x')],
      ),
    ).rejects.toThrow(/attachments_kind_check/);
  });

  it('serves content with safe headers only inside the workspace', async () => {
    const text = await uploaded(Buffer.from('héllo'), 'nötes.md', 'text/markdown');
    const response = await get(`/api/attachments/${text.id}/content`).expect(200);
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(response.headers['content-disposition']).toBe(
      `inline; filename="n_tes.md"; filename*=UTF-8''n%C3%B6tes.md`,
    );
    expect(response.text).toBe('héllo');

    const image = await uploaded(PNG, 'a.png', 'image/png');
    const bytes = await get(`/api/attachments/${image.id}/content`).expect(200);
    expect(bytes.headers['content-type']).toBe('image/png');

    const foreign = await foreignAttachment('secret');
    await get(`/api/attachments/${foreign.id}/content`).expect(404);
    await get(`/api/attachments/${randomUUID()}/content`).expect(404);
  });
});

describe('sending attachments', () => {
  it('links attachments to the message and returns them in the detail and the reply', async () => {
    const conversationId = randomUUID();
    const image = await uploaded(PNG, 'a.png', 'image/png');
    const notes = await uploaded(Buffer.from('notes'), 'b.txt', 'text/plain');
    const sent = await send(conversationId, 'Look', [image.id, notes.id]).expect(201);
    expect(sent.body.message.attachments).toEqual([image, notes]);

    const detail = await eventually(async () => {
      const response = await get(`/api/conversations/${conversationId}`).expect(200);
      const body = response.body as ConversationDetail;
      return body.messages.length === 2 ? body : null;
    });
    expect(detail.messages[0]!.attachments).toEqual([image, notes]);
    expect(detail.messages[1]!.attachments).toEqual([]);
    expect(detail.messages[1]!.content.endsWith(' Attachments: a.png, b.txt.')).toBe(true);
    expect(Object.values(detail.activity)[0]).toContainEqual(
      expect.objectContaining({ name: 'Reading 2 attachments', done: true }),
    );
  });

  it('returns the same attachments when a send is retried', async () => {
    const conversationId = randomUUID();
    const notes = await uploaded(Buffer.from('notes'), 'b.txt', 'text/plain');
    const body = { id: randomUUID(), content: 'Hi', attachmentIds: [notes.id] };
    const post = () =>
      request(app)
        .post(`/api/conversations/${conversationId}/messages`)
        .set(LOCAL_HEADERS)
        .set('Origin', ORIGIN)
        .send(body);
    const first = await post().expect(201);
    const retry = await post().expect(201);
    expect(retry.body.message).toEqual(first.body.message);
  });

  it('rejects attachments that are already sent, unknown, or from another workspace', async () => {
    const conversationId = randomUUID();
    const notes = await uploaded(Buffer.from('notes'), 'b.txt', 'text/plain');
    await send(conversationId, 'First', [notes.id]).expect(201);
    const before = await messageCount();

    const reused = await send(conversationId, 'Again', [notes.id]).expect(400);
    expect(reused.body.error).toMatch(/missing or already sent/);
    await send(conversationId, 'Unknown', [randomUUID()]).expect(400);

    const foreign = await foreignAttachment('x');
    await send(conversationId, 'Foreign', [foreign.id]).expect(400);
    expect(await messageCount()).toBe(before);
  });
});

describe('attachment lifecycle', () => {
  it('prunes day-old unsent attachments but keeps sent and fresh ones', async () => {
    const stale = await uploaded(Buffer.from('stale'), 'stale.txt', 'text/plain');
    const fresh = await uploaded(Buffer.from('fresh'), 'fresh.txt', 'text/plain');
    const sent = await uploaded(Buffer.from('sent'), 'sent.txt', 'text/plain');
    await send(randomUUID(), 'Keep', [sent.id]).expect(201);
    await t.db.query(
      `UPDATE attachments SET created_at = now() - interval '2 days' WHERE id = ANY($1::uuid[])`,
      [[stale.id, sent.id]],
    );
    await pruneUnlinkedAttachments(t.db, t.workspaceId);
    const { rows } = await t.db.query<{ id: string }>('SELECT id FROM attachments ORDER BY name');
    expect(rows.map((row) => row.id)).toEqual([fresh.id, sent.id]);
  });

  it('resends attachments from the last three user turns and names older ones', async () => {
    const conversationId = randomUUID();
    const runs: string[] = [];
    for (const index of [1, 2, 3, 4, 5]) {
      const file = await saveAttachment(t.db, t.workspaceId, {
        name: `f${index}.txt`,
        mediaType: 'text/plain',
        data: Buffer.from(`file ${index}`),
      });
      const result = await sendUserMessage(
        t.db,
        conversationId,
        { id: randomUUID(), content: `turn ${index}`, attachmentIds: [file.id] },
        { provider: 'fake' },
        t.workspaceId,
      );
      runs.push(result.run.id);
    }
    const input = await loadRunInput(t.db, runs[4]!);
    expect(input.attachments.map((file) => file.data.toString())).toEqual(['file 5']);
    expect(input.history.map((turn) => turn.content)).toEqual([
      'turn 1\n[Earlier attachment: f1.txt]',
      'turn 2',
      'turn 3',
      'turn 4',
    ]);
    expect(input.history.map((turn) => turn.attachments?.map((file) => file.name))).toEqual([
      undefined,
      ['f2.txt'],
      ['f3.txt'],
      ['f4.txt'],
    ]);
  });
});
