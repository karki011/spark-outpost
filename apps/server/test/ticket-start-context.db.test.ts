import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTicketResponseSchema, type Attachment } from '@spark-outpost/contracts';
import { memorySecretStore, type SecretStore } from '../src/setup/secrets.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { JIRA_EMAIL, JIRA_TOKEN } from './fake-jira.ts';
import { LINEAR_KEY } from './fake-linear.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { connectCliProvider, createTestDb, type TestDb } from './support.ts';
import { startTicketStubs, type TicketStubs } from './ticket-support.ts';

let t: TestDb;
let stubs: TicketStubs;
let secrets: SecretStore;
let app: ReturnType<typeof createTestApp>;
let scratch: string;
let tools: SparkToolsHarness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  stubs = await startTicketStubs();
  secrets = memorySecretStore();
  app = createTestApp(t, { secrets, fetch, linearApiUrl: stubs.linearUrl });
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-ticket-start-')));
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await stubs.close();
  await t.cleanup();
  await rm(scratch, { recursive: true, force: true });
});

const send = (method: 'put' | 'post', url: string, body: object = {}) =>
  request(app)[method](url).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
const get = (url: string) => request(app).get(url).set(LOCAL_HEADERS);

async function connectJira() {
  await send('put', '/api/tickets/connections/jira', {
    source: 'jira',
    siteUrl: `${stubs.jiraUrl}/`,
    email: JIRA_EMAIL,
    apiToken: JIRA_TOKEN,
  }).expect(200);
}

const upload = (data: string, name: string) =>
  request(app)
    .post('/api/attachments')
    .set(LOCAL_HEADERS)
    .set('Origin', ORIGIN)
    .set('Content-Type', 'text/plain')
    .set('X-File-Name', encodeURIComponent(name))
    .send(data);

const startBody = (body: object) => ({
  conversationId: randomUUID(),
  messageId: randomUUID(),
  moveToInProgress: false,
  ...body,
});

async function folder(...parts: string[]) {
  const target = path.join(scratch, ...parts);
  await mkdir(target, { recursive: true });
  return target;
}

describe('starting a ticket with extra context', () => {
  it('sends a short brief with the note and references and keeps them on the task', async () => {
    await connectJira();
    await connectCliProvider(t, 'claude');
    const projectRoot = await folder('web');
    const project = (await send('post', '/api/projects', { rootPath: projectRoot }).expect(201))
      .body as { id: string };
    const reports = await folder('web', 'reports');
    const designs = await folder('designs');
    const spec = (await upload('# Spec\nKeep it small.', 'spec.md').expect(201)).body as Attachment;

    const body = startBody({
      mode: 'plan',
      note: 'Match the billing CSV format.',
      links: ['https://docs.example.com/csv'],
      attachmentIds: [spec.id],
      folders: [reports, designs],
    });
    const response = await send('post', '/api/tickets/jira/WEB-418/start', body).expect(201);
    const started = startTicketResponseSchema.parse(response.body);

    const detail = (await get(`/api/conversations/${started.conversationId}`).expect(200)).body;
    expect(detail.settings.level).toBe('full-auto');
    const message = detail.messages.find((m: { role: string }) => m.role === 'user');
    expect(message.content).toContain('## Ticket data from Jira');
    expect(message.content).toContain('untrusted third-party text');
    expect(message.content).toContain('spark_tickets with action "read" and key WEB-418');
    expect(message.content).toContain('### Acceptance criteria');
    expect(message.content).not.toContain('Include cost too.');
    expect(message.content).toContain('## Note from me\n\nMatch the billing CSV format.');
    expect(message.content).toContain('- Link: https://docs.example.com/csv');
    expect(message.content).toContain('- File: spec.md (attached to this message)');
    expect(message.content).toContain(`- Folder: ${reports} (read it with your tools`);
    expect(message.content).toContain(`- Folder: ${designs} (read it with your tools`);
    expect(message.attachments).toEqual([
      expect.objectContaining({ id: spec.id, name: 'spec.md' }),
    ]);

    const task = (await get(`/api/tasks/${started.taskId}`).expect(200)).body;
    expect(task.links).toEqual([
      expect.objectContaining({ kind: 'link', source: 'ticket' }),
      expect.objectContaining({
        kind: 'link',
        source: 'user',
        url: 'https://docs.example.com/csv',
      }),
      expect.objectContaining({
        kind: 'file',
        source: 'user',
        title: 'spec.md',
        url: `/attachments/${spec.id}/content`,
      }),
      expect.objectContaining({ kind: 'folder', source: 'user', url: reports, title: 'reports' }),
      expect.objectContaining({ kind: 'folder', source: 'user', url: designs, title: 'designs' }),
    ]);

    const { rows } = await t.db.query<{ root_path: string; id: string }>(
      `SELECT p.id, p.root_path FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
       WHERE cp.conversation_id = $1 ORDER BY cp.position`,
      [started.conversationId],
    );
    expect(rows.map((row) => row.root_path)).toEqual([projectRoot, designs]);
    expect(rows[0]!.id).toBe(project.id);

    const again = await send('post', '/api/tickets/jira/WEB-418/start', body).expect(201);
    expect(again.body.runId).toBe(started.runId);
  });

  it('refuses secret files, hidden folders and missing folders', async () => {
    await connectJira();
    const refused = await upload('TOKEN=abc', '.env').expect(400);
    expect(refused.body.error).toBe('Spark never reads secret files like .env.');
    await upload('-----BEGIN KEY-----', 'deploy.pem').expect(400);

    const hidden = await folder('.ssh');
    const hiddenStart = await send(
      'post',
      '/api/tickets/jira/WEB-418/start',
      startBody({ folders: [hidden] }),
    ).expect(400);
    expect(hiddenStart.body.error).toContain('hidden folders');
    await send(
      'post',
      '/api/tickets/jira/WEB-418/start',
      startBody({ folders: [path.join(scratch, 'missing')] }),
    ).expect(400);
    await send(
      'post',
      '/api/tickets/jira/WEB-418/start',
      startBody({ links: ['javascript:alert(1)'] }),
    ).expect(400);
    const { rows } = await t.db.query('SELECT 1 FROM tasks');
    expect(rows).toEqual([]);
  });
});

describe('spark_tickets read', () => {
  it("reads this chat's ticket in full, marked untrusted and redacted", async () => {
    await connectJira();
    const leaked = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const issue = stubs.jira.issues.find((entry) => entry.key === 'WEB-418')!;
    issue.comments.push({
      author: 'Robin',
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `token ${leaked}` }] }],
      },
      created: '2026-09-27T08:00:00.000+0000',
    });
    const body = startBody({});
    await send('post', '/api/tickets/jira/WEB-418/start', body).expect(201);
    tools = await startSparkTools(
      t,
      { conversationId: body.conversationId },
      { secrets, linearApiUrl: stubs.linearUrl },
    );

    const result = await tools.call('spark_tickets', { action: 'read' });
    expect(result.isError).toBe(false);
    expect(result.text).not.toContain(leaked);
    const read = result.json<{
      untrusted: string;
      ticket: {
        key: string;
        status: string;
        description: string;
        comments: { author: string; body: string }[];
        subtasks: { key: string }[];
      };
    }>();
    expect(read.untrusted).toContain('third-party text from Jira');
    expect(read.ticket).toMatchObject({ key: 'WEB-418', status: 'To Do' });
    expect(read.ticket.description).toContain('People want the usage table in a spreadsheet.');
    expect(read.ticket.comments.map((comment) => comment.author)).toEqual(['Sam', 'Robin']);
    expect(read.ticket.subtasks).toEqual([expect.objectContaining({ key: 'WEB-419' })]);

    const other = await tools.call('spark_tickets', { action: 'read', key: 'WEB-437' });
    expect(other.json<{ ticket: { key: string } }>().ticket.key).toBe('WEB-437');
  });

  it('asks for a key when the chat has no linked ticket', async () => {
    await send('put', '/api/tickets/connections/linear', {
      source: 'linear',
      apiKey: LINEAR_KEY,
    }).expect(200);
    tools = await startSparkTools(
      t,
      { conversationId: randomUUID() },
      {
        secrets,
        linearApiUrl: stubs.linearUrl,
      },
    );
    const result = await tools.call('spark_tickets', { action: 'read' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('pass key');
    const read = await tools.call('spark_tickets', { action: 'read', key: 'ENG-12' });
    expect(read.json<{ ticket: { key: string } }>().ticket.key).toBe('ENG-12');
  });
});
