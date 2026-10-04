import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileViewResponseSchema, type FileFocus } from '@spark-outpost/contracts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { createProject } from '../src/projects/projects.ts';
import { runEvents } from '../src/workflow/run-events.ts';
import { createTestApp, localClient } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let outside: string;

beforeEach(async () => {
  t = await createTestDb();
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-file-view-')));
  outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'spark-file-view-out-')));
  mkdirSync(path.join(root, 'src'));
  const lines = Array.from({ length: 80 }, (_, index) => `const row${index + 1} = ${index + 1};`);
  writeFileSync(path.join(root, 'src/invoice.ts'), `${lines.join('\n')}\n`);
  writeFileSync(path.join(root, '.env'), 'TOKEN=never-shown\n');
  writeFileSync(path.join(root, '.sparkignore'), 'private/\n');
  mkdirSync(path.join(root, 'private'));
  writeFileSync(path.join(root, 'private/notes.txt'), 'ignored-never-shown\n');
  writeFileSync(path.join(root, 'logo.bin'), Buffer.from([1, 0, 2, 0]));
  writeFileSync(path.join(outside, 'passwd'), 'outside-never-shown\n');
  symlinkSync(path.join(outside, 'passwd'), path.join(root, 'src/link.ts'));
});

afterEach(async () => {
  await t.cleanup();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

async function liveChat(linked = true) {
  const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
  if (linked) {
    const { project } = await createProject(t.db, t.workspaceId, root);
    await t.db.query(
      'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
      [conversation.id, project.id],
    );
  }
  const sent = await sendUserMessage(
    t.db,
    conversation.id,
    { id: randomUUID(), content: 'Fix the invoice' },
    { provider: 'fake', permission: 'ask', agentMode: null, level: 'hands-off' },
  );
  await t.db.query(`UPDATE runs SET status = 'running', started_at = now() WHERE id = $1`, [
    sent.run.id,
  ]);
  return { conversationId: conversation.id, runId: sent.run.id };
}

async function look(runId: string, focus: Partial<FileFocus> & { path: string }) {
  const event = runEvents.fileFocus({ line: null, limit: null, action: 'read', ...focus });
  await t.db.query(
    `INSERT INTO run_events (run_id, seq, type, payload)
     VALUES ($1, (SELECT COALESCE(max(seq), 0) + 1 FROM run_events WHERE run_id = $1), $2, $3)`,
    [runId, event.type, JSON.stringify(event)],
  );
}

async function view(conversationId: string) {
  const response = await localClient(createTestApp(t)).get(
    `/api/conversations/${conversationId}/file-view`,
  );
  expect(response.status).toBe(200);
  expect(JSON.stringify(response.body)).not.toContain('never-shown');
  return fileViewResponseSchema.parse(response.body);
}

describe('GET /api/conversations/:id/file-view', () => {
  it('serves the lines around the latest read inside the linked project', async () => {
    const chat = await liveChat();
    expect(await view(chat.conversationId)).toEqual({ view: null, refused: null });
    await look(chat.runId, { path: path.join(root, 'src/invoice.ts') });
    await look(chat.runId, { path: path.join(root, 'src/invoice.ts'), line: 30, limit: 5 });
    const { view: shown, refused } = await view(chat.conversationId);
    expect(refused).toBeNull();
    expect(shown).toMatchObject({
      runId: chat.runId,
      action: 'read',
      name: 'invoice.ts',
      path: 'src/invoice.ts',
      firstLine: 27,
      totalLines: 80,
      focus: { from: 30, to: 34 },
    });
    expect(shown!.lines).toHaveLength(40);
    expect(shown!.lines[3]).toBe('const row30 = 30;');
    expect(JSON.stringify(shown)).not.toContain(root);
  });

  it('resolves a relative path against the project and shows an edit’s line', async () => {
    const chat = await liveChat();
    await look(chat.runId, { path: 'src/invoice.ts', line: 8, action: 'edit' });
    const { view: shown } = await view(chat.conversationId);
    expect(shown).toMatchObject({ action: 'edit', firstLine: 5, focus: { from: 8, to: 8 } });
  });

  it('refuses a secret file and a file .sparkignore hides', async () => {
    const chat = await liveChat();
    await look(chat.runId, { path: path.join(root, '.env') });
    expect(await view(chat.conversationId)).toEqual({ view: null, refused: 'secret file' });
    await look(chat.runId, { path: path.join(root, 'private/notes.txt') });
    expect(await view(chat.conversationId)).toEqual({ view: null, refused: 'secret file' });
  });

  it('refuses a path outside the project, by path, by .. and through a link', async () => {
    const chat = await liveChat();
    for (const target of [
      path.join(outside, 'passwd'),
      path.join(root, '..', path.basename(outside), 'passwd'),
      path.join(root, 'src/link.ts'),
    ]) {
      await look(chat.runId, { path: target });
      expect(await view(chat.conversationId)).toEqual({
        view: null,
        refused: 'outside the project',
      });
    }
  });

  it('refuses when the chat has no linked project, and for binary and missing files', async () => {
    const loose = await liveChat(false);
    await look(loose.runId, { path: path.join(root, 'src/invoice.ts') });
    expect((await view(loose.conversationId)).refused).toBe('outside the project');
    const chat = await liveChat();
    await look(chat.runId, { path: path.join(root, 'logo.bin') });
    expect((await view(chat.conversationId)).refused).toBe('not text');
    await look(chat.runId, { path: path.join(root, 'src/gone.ts') });
    expect((await view(chat.conversationId)).refused).toBe('not found');
  });

  it('shows nothing once the run has ended, for a stored focus that is not valid, or another chat', async () => {
    const chat = await liveChat();
    await look(chat.runId, { path: path.join(root, 'src/invoice.ts') });
    const other = await liveChat();
    expect(await view(other.conversationId)).toEqual({ view: null, refused: null });
    await t.db.query(
      `UPDATE run_events SET payload = jsonb_set(payload, '{content,path}', '42') WHERE run_id = $1`,
      [chat.runId],
    );
    expect(await view(chat.conversationId)).toEqual({ view: null, refused: null });
    await look(chat.runId, { path: path.join(root, 'src/invoice.ts') });
    expect((await view(chat.conversationId)).view?.name).toBe('invoice.ts');
    await t.db.query(`UPDATE runs SET status = 'succeeded' WHERE id = $1`, [chat.runId]);
    expect(await view(chat.conversationId)).toEqual({ view: null, refused: null });
    expect(await view(randomUUID())).toEqual({ view: null, refused: null });
  });
});
