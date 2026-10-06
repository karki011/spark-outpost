import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { saveAttachment } from '../src/persistence/attachments.ts';
import { insertBrowserShot } from '../src/persistence/browser-screenshots.ts';
import { getRun } from '../src/persistence/runs.ts';
import { createFakeProvider } from '../src/providers/fake.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { createTestApp, localClient } from './app-support.ts';
import { doRun, insertCommandApproval } from './approval-support.ts';
import { pairDevice, remoteClient, turnRemoteOn } from './remote-support.ts';
import { createTestDb, eventually, startChat, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null;
let app: ReturnType<typeof createTestApp>;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-remote-chat-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function startFakeWorker(): Worker {
  const provider = createFakeProvider({ stepMs: 0, wordMs: 0 });
  return startWorker({
    db: t.db,
    providers: new Map([[provider.name, provider]]),
    leaseSeconds: 30,
    concurrency: 1,
    pollMs: 20,
  });
}

beforeEach(async () => {
  t = await createTestDb();
  worker = startFakeWorker();
  app = createTestApp(t);
  await turnRemoteOn(app);
});

afterEach(async () => {
  await worker?.stop();
  await t.cleanup();
});

function eventTypesIn(sse: string): string[] {
  return sse
    .split('\n\n')
    .filter((frame) => frame.startsWith('id: '))
    .map((frame) => (JSON.parse(frame.split('\n')[1]!.slice(6)) as { type: string }).type);
}

describe('a paired phone on a chat started on the Mac', () => {
  it('reads the chat, follows the run, sends a message and stops a run', async () => {
    const mac = localClient(app);
    const conversationId = crypto.randomUUID();
    await mac.send('post', '/api/conversations', { id: conversationId }).expect(201);
    const first = await mac
      .send('post', `/api/conversations/${conversationId}/messages`, {
        id: crypto.randomUUID(),
        content: 'Hello from the Mac',
      })
      .expect(201);
    const firstRun = first.body.run.id as string;
    await eventually(async () => (await getRun(t.db, firstRun))?.finishedAt);

    const device = await pairDevice(app, 'Pocket phone');
    const phone = remoteClient(app, device.cookie);

    const listed = await phone.get('/api/conversations').expect(200);
    expect(JSON.stringify(listed.body)).toContain(conversationId);
    const detail = await phone.get(`/api/conversations/${conversationId}`).expect(200);
    expect(JSON.stringify(detail.body)).toContain('Hello from the Mac');

    const stream = await phone.get(`/api/runs/${firstRun}/events`).expect(200);
    const types = eventTypesIn(stream.text);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types.at(-1)).toBe('RUN_FINISHED');
    const resumed = await phone.get(`/api/runs/${firstRun}/events`).set('Last-Event-ID', '3');
    expect(eventTypesIn(resumed.text)).toEqual(types.slice(3));

    const sent = await phone
      .send('post', `/api/conversations/${conversationId}/messages`, {
        id: crypto.randomUUID(),
        content: 'And from the phone',
      })
      .expect(201);
    await eventually(async () => (await getRun(t.db, sent.body.run.id))?.finishedAt);
    const after = await mac.get(`/api/conversations/${conversationId}`).expect(200);
    expect(JSON.stringify(after.body)).toContain('And from the phone');

    await worker!.stop();
    worker = null;
    const queued = await phone
      .send('post', `/api/conversations/${conversationId}/messages`, {
        id: crypto.randomUUID(),
        content: 'Stop this one',
      })
      .expect(201);
    const stopped = await phone.send('post', `/api/runs/${queued.body.run.id}/cancel`);
    expect([200, 202]).toContain(stopped.status);
    expect((await getRun(t.db, queued.body.run.id))?.status).toBe('cancelled');

    const audited = await t.db.query<{ path: string }>(
      `SELECT path FROM remote_audit WHERE action = 'request' AND device_id = $1
       ORDER BY created_at, id`,
      [device.id],
    );
    expect(audited.rows.map((row) => row.path)).toEqual([
      `/api/conversations/${conversationId}/messages`,
      `/api/conversations/${conversationId}/messages`,
      `/api/runs/${queued.body.run.id}/cancel`,
    ]);
  });

  it('sees a browser screenshot of the chat in place and can fetch its image', async () => {
    const chat = await startChat(t, 'Check the settings page');
    const data = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const attachment = await saveAttachment(t.db, t.workspaceId, {
      name: 'browser.png',
      mediaType: 'image/png',
      data,
    });
    await insertBrowserShot(t.db, {
      runId: chat.runId,
      attachment,
      page: 'http://localhost:5173/settings',
      title: 'Settings',
      width: 1280,
      height: 800,
      sha256: 'a'.repeat(64),
      anchor: { textOffset: 12, textBefore: 'Opening it.', textHeld: 0 },
    });
    const device = await pairDevice(app, 'Pocket phone');
    const phone = remoteClient(app, device.cookie);

    const detail = await phone.get(`/api/conversations/${chat.conversationId}`).expect(200);
    expect(detail.body.browserShots).toEqual([
      expect.objectContaining({
        runId: chat.runId,
        width: 1280,
        height: 800,
        textOffset: 12,
        textBefore: 'Opening it.',
      }),
    ]);
    const image = await phone.get(`/api/attachments/${attachment.id}/content`).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(Buffer.from(image.body as Buffer).equals(data)).toBe(true);
    await remoteClient(app).get(`/api/attachments/${attachment.id}/content`).expect(401);
  });

  it('answers a card, and the Mac then finds it answered', async () => {
    const { runId } = await doRun(t, root);
    const approval = await insertCommandApproval(t, runId, root, 'pnpm test');
    const device = await pairDevice(app);
    const phone = remoteClient(app, device.cookie);

    const answered = await phone
      .send('post', `/api/approvals/${approval.id}/decision`, { optionId: 'allow', scope: 'once' })
      .expect(200);
    expect(answered.body).toMatchObject({ status: 'allowed', decidedBy: 'user' });
    await localClient(app)
      .send('post', `/api/approvals/${approval.id}/decision`, { optionId: 'reject', scope: 'once' })
      .expect(409);
  });
});

describe('focus reported per client', () => {
  it('names the Mac window and the phone apart, whatever id the phone sends', async () => {
    const focused: Record<string, boolean> = {};
    const slackNotifier = {
      setFocused(next: boolean, clientId?: string) {
        focused[clientId ?? 'none'] = next;
      },
    };
    app = createTestApp(t, { slackNotifier });
    const device = await pairDevice(app);
    const phone = remoteClient(app, device.cookie);
    const mac = localClient(app);

    await mac.send('post', '/api/slack/presence', { focused: true, clientId: 'tab-1' }).expect(204);
    await phone
      .send('post', '/api/slack/presence', { focused: true, clientId: 'local:tab-1' })
      .expect(204);
    await mac
      .send('post', '/api/slack/presence', { focused: false, clientId: 'tab-1' })
      .expect(204);
    await mac.send('post', '/api/slack/presence', { focused: true }).expect(204);

    expect(focused).toEqual({
      'local:tab-1': false,
      [`device:${device.id}`]: true,
      'local:window': true,
    });
  });
});
