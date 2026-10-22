import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chatWorkFolder } from '../src/chat-files/folders.ts';
import { ensureAssistantChat } from '../src/companion/assistant.ts';
import { setConversationProjects } from '../src/persistence/conversation-projects.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { createProject } from '../src/projects/projects.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  repliesOf,
  sendMessage,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';

let t: TestDb;
let base: string;
let worker: Worker | null = null;
const cleanups: string[] = [];

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-chat-folders-')));
  await connectAgents(t);
  worker = startTurnWorker(t, { chatFolders: base });
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
  for (const path of cleanups.splice(0)) await removeRepo(path);
});

async function say(conversationId: string, text: string, permission: 'ask' | 'do' = 'do') {
  const runId = await sendMessage(t, conversationId, text, { permission });
  const { run } = await driveToEnd(t, conversationId, runId);
  return { run, runId, reply: (await repliesOf(t, runId)).join('\n') };
}

describe('a chat with no project', { timeout: 60_000 }, () => {
  it('gets its own private folder the first time a turn needs tools', async () => {
    const conversationId = await openChat(t);
    const folder = chatWorkFolder(base, conversationId);
    expect(existsSync(folder)).toBe(false);

    const { run, reply } = await say(conversationId, 'Where are you? #cwd');

    expect(run).toMatchObject({ status: 'succeeded', mode: 'do' });
    expect(reply).toContain(`cwd=${folder}`);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(reply).not.toContain('No pull request');
  });

  it('keeps a file the agent writes as an attachment of the turn that made it', async () => {
    const conversationId = await openChat(t);
    const folder = chatWorkFolder(base, conversationId);

    const first = await say(conversationId, `Save it. #fswrite ${join(folder, 'notes.csv')}`);
    const second = await say(conversationId, 'Nothing new here.');

    expect(first.reply).toContain('=ok:');
    expect(await readFile(join(folder, 'notes.csv'), 'utf8')).toBe('x');
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.chatFiles).toEqual([
      expect.objectContaining({
        runId: first.runId,
        name: 'notes.csv',
        path: 'notes.csv',
        size: 1,
        mediaType: 'text/csv',
        kind: 'file',
      }),
    ]);
    expect(detail?.chatFiles?.some((file) => file.runId === second.runId)).toBe(false);
    expect(first.reply).not.toContain('No pull request');
  });

  it('still refuses a write outside its folder', async () => {
    const conversationId = await openChat(t);
    const outside = join(process.cwd(), `outside-${randomUUID()}.txt`);

    const { reply } = await say(conversationId, `Write there. #fswrite ${outside}`);

    expect(reply).toContain(`[write ${outside}=err:`);
    expect(existsSync(outside)).toBe(false);
  });

  it('works in the project once one is picked, and earlier files stay with their turn', async () => {
    const conversationId = await openChat(t);
    const folder = chatWorkFolder(base, conversationId);
    const first = await say(conversationId, `Save it. #fswrite ${join(folder, 'notes.csv')}`);
    const root = await gitRepo();
    cleanups.push(root);
    const { project } = await createProject(t.db, t.workspaceId, root);
    await setConversationProjects(t.db, t.workspaceId, conversationId, [project.id]);

    const later = await say(conversationId, 'Where now? #cwd');

    expect(later.reply).not.toContain(`cwd=${folder}`);
    expect(existsSync(join(root, 'notes.csv'))).toBe(false);
    const detail = await getConversationDetail(t.db, conversationId);
    expect(detail?.chatFiles?.map((file) => file.runId)).toEqual([first.runId]);
  });

  it('keeps Ask Spark’s hidden chat talking only', async () => {
    await t.db.query(
      `INSERT INTO profiles (workspace_id, display_name, default_provider, onboarding_completed_at)
       VALUES ($1, 'Test User', 'claude', now())`,
      [t.workspaceId],
    );
    const conversationId = await ensureAssistantChat(t.db, t.workspaceId);

    const runId = await sendMessage(t, conversationId, 'Hi', { permission: 'do' });

    const { rows } = await t.db.query<{ mode: string }>('SELECT mode FROM runs WHERE id = $1', [
      runId,
    ]);
    expect(rows[0]?.mode).toBe('chat');
  });
});
