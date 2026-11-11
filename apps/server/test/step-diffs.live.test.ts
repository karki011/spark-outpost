import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConversationDetail, sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import { saveConnection } from '../src/persistence/setup.ts';
import { createProviders } from '../src/workflow/providers.ts';
import { startWorker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let repo: string;

beforeAll(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-live-diff-')));
  repo = join(base, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  await writeFile(join(repo, 'README.md'), '# Live probe\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', [
    '-C',
    repo,
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    'commit',
    '-qm',
    'base',
  ]);
});

afterAll(async () => {
  await t.cleanup();
  await rm(base, { recursive: true, force: true });
});

describe('live Claude edit without an approval card', () => {
  it('keeps the diff of the edit on its step and proposes a chat title', async () => {
    await saveConnection(t.db, t.workspaceId, 'claude', {
      method: 'cli',
      detail: 'live',
      summary: '',
      models: [],
    });
    const { conversationId } = await linkedConversation(t, repo);
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      {
        id: randomUUID(),
        content:
          'Edit README.md so it ends with a new line `Edited by Spark`. Use one edit tool call, then reply with one short line.',
      },
      {
        provider: 'claude',
        effort: 'low',
        permission: 'do',
        agentMode: 'acceptEdits',
        level: 'hands-off',
      },
    );
    const worker = startWorker({
      db: t.db,
      providers: createProviders('acp'),
      leaseSeconds: 30,
      pollMs: 100,
      approvalPollMs: 200,
    });
    try {
      for (let tick = 0; tick < 800; tick++) {
        const run = await getRun(t.db, sent.run.id);
        if (run?.finishedAt) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      await worker.stop();
    }

    const run = await getRun(t.db, sent.run.id);
    const detail = await getConversationDetail(t.db, conversationId);
    const steps = detail?.activity[sent.run.id] ?? [];
    const diffs = steps.flatMap((step) => step.diffs ?? []);
    const title = await t.db.query<{ suggested_title: string | null }>(
      'SELECT suggested_title FROM runs WHERE id = $1',
      [sent.run.id],
    );
    console.log('live edit run', {
      status: run?.status,
      error: run?.error,
      approvals: detail?.approvals.length,
      steps: steps.map((step) => ({ name: step.name, diffs: step.diffs?.length ?? 0 })),
      diffs: diffs.map(({ path, added, removed, truncated }) => ({
        path,
        added,
        removed,
        truncated,
      })),
      suggestedTitle: title.rows[0]?.suggested_title,
      chatTitle: detail?.conversation.title,
    });

    expect(run?.status).toBe('succeeded');
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toContain('Edited by Spark');
    const readme = diffs.find((diff) => diff.path.endsWith('README.md'));
    expect(readme?.newText).toContain('Edited by Spark');
    expect(readme?.added).toBeGreaterThan(0);
  });
});
