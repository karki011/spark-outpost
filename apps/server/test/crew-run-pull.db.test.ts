import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertWorkflowRun, workflowRunById } from '../src/crew-flows/run-records.ts';
import { runPull } from '../src/crew-flows/step-place-gather.ts';
import { runPullLine } from '../src/crew-flows/step-place.ts';
import { step } from './crew-workflow-support.ts';
import { createTestDb, startChat, type TestDb } from './support.ts';

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

async function openPull(conversationId: string, number: number, minutesAgo: number) {
  await t.db.query(
    `INSERT INTO pr_watches (id, workspace_id, conversation_id, host, owner, repo, number, url,
       branch, base, head_sha, pr_state, updated_at)
     VALUES ($1, $2, $3, 'github.com', 'acme', 'widgets', $4, $5, $6, 'main', 'sha1', 'open',
       now() - make_interval(mins => $7))`,
    [
      randomUUID(),
      t.workspaceId,
      conversationId,
      number,
      `https://github.com/acme/widgets/pull/${number}`,
      `spark/change-${number}`,
      minutesAgo,
    ],
  );
}

async function run(conversationId: string, runId: string, message: string) {
  const id = randomUUID();
  await insertWorkflowRun(t.db, {
    id,
    workspaceId: t.workspaceId,
    workflow: { id: 'gauntlet', name: 'The Gauntlet', steps: [step('look', randomUUID())] },
    kind: 'run',
    source: 'mention',
    conversationId,
    runId,
    message,
    continues: false,
  });
  return (await workflowRunById(t.db, id))!;
}

describe('the pull request a workflow run is about', () => {
  it('says Spark picked the newest when a chat has several open and the message names none', async () => {
    const { conversationId, runId } = await startChat(t, '@gauntlet look');
    await openPull(conversationId, 3, 30);
    await openPull(conversationId, 5, 1);
    await openPull(conversationId, 4, 10);
    const target = await runPull(t.db, await run(conversationId, runId, 'look'));
    expect(target).toEqual({ id: 'acme/widgets#5', named: false, openInChat: 3 });
    expect(runPullLine(target!)).toContain('picked the most recently updated of this chat’s 3');
  });

  it('uses the pull request the message links to', async () => {
    const { conversationId, runId } = await startChat(t, '@gauntlet look');
    await openPull(conversationId, 3, 30);
    await openPull(conversationId, 5, 1);
    const message = 'look at https://github.com/acme/widgets/pull/3';
    const target = await runPull(t.db, await run(conversationId, runId, message));
    expect(target).toMatchObject({ id: 'acme/widgets#3', named: true });
  });

  it('is none when the chat has no open pull request and the message names none', async () => {
    const { conversationId, runId } = await startChat(t, '@gauntlet look');
    expect(await runPull(t.db, await run(conversationId, runId, 'look'))).toBeNull();
  });
});
