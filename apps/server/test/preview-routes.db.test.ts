import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chatPreviewSchema,
  projectPreviewSchema,
  projectSchema,
  type TerminalServerMessage,
} from '@spark-outpost/contracts';
import { PreviewServers } from '../src/preview/servers.ts';
import { loginShellSpawner } from '../src/terminal/pty.ts';
import { TerminalSessions } from '../src/terminal/sessions.ts';
import { createTestApp, localClient } from './app-support.ts';
import { linkedConversation } from './approval-support.ts';
import { FAST_PREVIEW, fakePreviewRuntime, type FakePreviewRuntime } from './preview-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let root: string;
let fake: FakePreviewRuntime;
let previews: PreviewServers;
let terminals: TerminalSessions;
let client: ReturnType<typeof localClient>;
let chat: { conversationId: string; projectId: string };

beforeEach(async () => {
  t = await createTestDb();
  base = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-preview-routes-')));
  root = path.join(base, 'site');
  mkdirSync(root);
  fake = fakePreviewRuntime();
  previews = new PreviewServers(t.db, t.workspaceId, fake.runtime, FAST_PREVIEW);
  terminals = new TerminalSessions(loginShellSpawner('/bin/sh'));
  client = localClient(createTestApp(t, { terminals, previews }));
  chat = await linkedConversation(t, root);
});

afterEach(async () => {
  terminals.killAll();
  await previews.stopAll('test');
  rmSync(base, { recursive: true, force: true });
  await t.cleanup();
});

const save = (preview: unknown) =>
  client.send('put', `/api/projects/${chat.projectId}/preview`, { preview });

async function chatPreview() {
  const response = await client.get(`/api/conversations/${chat.conversationId}/preview`);
  return chatPreviewSchema.parse(response.body);
}

describe('the Preview setting of a project', () => {
  it('saves the command, address, folder and ready address, and clears them', async () => {
    const saved = await save({
      command: '  pnpm dev ',
      url: 'localhost:5173',
      folder: './apps/web/',
      readyUrl: '',
    });
    expect(saved.status).toBe(200);
    expect(projectSchema.parse(saved.body).preview).toEqual({
      command: 'pnpm dev',
      url: 'http://localhost:5173',
      folder: 'apps/web',
      readyUrl: null,
    });
    const listed = await client.get('/api/projects');
    expect(listed.body[0].preview.command).toBe('pnpm dev');

    expect((await save(null)).body.preview).toBeNull();
  });

  it('refuses an address that is not on this Mac, a folder outside the project and a command of two lines', async () => {
    const good = { command: 'pnpm dev', url: 'http://localhost:5173' };
    for (const bad of [
      { ...good, url: 'https://example.com' },
      { ...good, url: 'file:///etc/hosts' },
      { ...good, folder: '../other' },
      { ...good, folder: '/etc' },
      { ...good, command: 'pnpm dev\nrm -rf ~' },
      { ...good, command: '' },
      { ...good, extra: true },
    ]) {
      expect((await save(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('suggests from package.json and reads .claude/launch.json without changing it', async () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '7' } }),
    );
    mkdirSync(path.join(root, '.claude'));
    const launch = JSON.stringify({
      configurations: [
        { name: 'site', runtimeExecutable: 'node', runtimeArgs: ['server.js'], port: 4100 },
      ],
    });
    writeFileSync(path.join(root, '.claude', 'launch.json'), launch);
    const response = await client.get(`/api/projects/${chat.projectId}/preview`);
    const { preview, suggestions } = projectPreviewSchema.parse(response.body);
    expect(preview).toBeNull();
    expect(
      suggestions.map((entry) => [entry.source, entry.config.command, entry.config.url]),
    ).toEqual([
      ['launch.json', 'node server.js', 'http://localhost:4100'],
      ['package.json', 'npm run dev', 'http://localhost:5173'],
    ]);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path.join(root, '.claude', 'launch.json'), 'utf8')).toBe(launch);
  });
});

describe('the preview of a chat', () => {
  it('starts from the pane, shows as a Preview terminal, and stops', async () => {
    expect(await chatPreview()).toMatchObject({
      projectId: chat.projectId,
      preview: null,
      server: null,
    });
    const early = await client.send(
      'post',
      `/api/conversations/${chat.conversationId}/preview/start`,
    );
    expect(early.status).toBe(400);
    expect(early.body.error).toContain('Settings, Projects');

    await save({ command: 'node server.js', url: 'http://localhost:4100' });
    fake.answering.add('http://localhost:4100/');
    const started = await client.send(
      'post',
      `/api/conversations/${chat.conversationId}/preview/start`,
    );
    expect(chatPreviewSchema.parse(started.body).server).toMatchObject({
      status: 'starting',
      askedBy: 'user',
      folder: root,
    });
    await eventually(async () => ((await chatPreview()).server?.status === 'ready' ? true : null));
    fake.spawned[0]!.print('listening\r\n');

    const ticket = await client.send('post', '/api/terminal/previews', {
      conversationId: chat.conversationId,
    });
    expect(ticket.status).toBe(201);
    expect(ticket.body).toMatchObject({ label: 'Preview', cwd: root, kind: 'project' });
    const output: string[] = [];
    const messages: TerminalServerMessage[] = [];
    const attached = terminals.attach(
      ticket.body.id,
      ticket.body.token,
      {
        output: (data) => output.push(data),
        send: (message) => messages.push(message),
        close: () => undefined,
      },
      { cols: 80, rows: 24 },
    );
    expect(output).toEqual(['listening\r\n']);
    expect(await client.get(`/api/terminal/sessions/${ticket.body.id}/busy`)).toMatchObject({
      body: { command: null },
    });
    attached.disconnect();
    expect(fake.spawned[0]!.killed).toBe(false);

    const second = await client.send('post', '/api/terminal/previews', {
      conversationId: chat.conversationId,
    });
    terminals.attach(
      second.body.id,
      second.body.token,
      {
        output: () => undefined,
        send: (message) => messages.push(message),
        close: () => undefined,
      },
      { cols: 80, rows: 24 },
    );
    const stopped = await client.send(
      'post',
      `/api/conversations/${chat.conversationId}/preview/stop`,
    );
    expect(chatPreviewSchema.parse(stopped.body).server).toMatchObject({
      status: 'stopped',
      url: null,
    });
    expect(fake.spawned[0]!.killed).toBe(true);
    expect(messages).toEqual([
      { type: 'ended', reason: 'disconnected', exitCode: null },
      { type: 'ended', reason: 'exited', exitCode: null },
    ]);

    const gone = await client.send('post', '/api/terminal/previews', {
      conversationId: chat.conversationId,
    });
    expect(gone.status).toBe(400);
  });

  it('stops a running preview when its setting changes, so the next start uses the new command', async () => {
    await save({ command: 'node server.js', url: 'http://localhost:4100' });
    fake.answering.add('http://localhost:4100/');
    await client.send('post', `/api/conversations/${chat.conversationId}/preview/start`);
    await eventually(async () => ((await chatPreview()).server?.status === 'ready' ? true : null));

    await save({ command: 'node other.js', url: 'http://localhost:4100' });
    expect(fake.spawned[0]!.killed).toBe(true);
    expect((await chatPreview()).server?.status).toBe('stopped');
    await client.send('post', `/api/conversations/${chat.conversationId}/preview/start`);
    expect(fake.spawned[1]!.options.command).toBe('node other.js');
  });
});
