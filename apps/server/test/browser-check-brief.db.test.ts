import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import { getRun } from '../src/persistence/runs.ts';
import type { Provider } from '../src/providers/provider.ts';
import { BROWSER_CHECK_LINE } from '../src/workflow/browser-check.ts';
import { startWorker, type Worker } from '../src/workflow/worker.ts';
import { linkedConversation } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let worker: Worker | null = null;
let prompts: string[];
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  prompts = [];
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'spark-browser-check-')));
});

afterEach(async () => {
  await worker?.stop();
  worker = null;
  rmSync(root, { recursive: true, force: true });
  await t.cleanup();
});

const recording: Provider = {
  name: 'fake',
  async *run(turn) {
    prompts.push(turn.prompt);
    yield { kind: 'text_delta', delta: 'Done.' };
  },
};

async function turnPrompt(content: string, mode: 'do' | 'ask', browserPane: boolean) {
  const { conversationId } = await linkedConversation(t, root);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content },
    { provider: 'fake', model: 'fake-fast', effort: 'low' },
  );
  await t.db.query('UPDATE runs SET mode = $2 WHERE id = $1', [sent.run.id, mode]);
  await worker?.stop();
  prompts = [];
  worker = startWorker({
    db: t.db,
    providers: new Map([['fake', recording]]),
    leaseSeconds: 30,
    pollMs: 20,
    browserPane,
  });
  await eventually(async () => ((await getRun(t.db, sent.run.id))?.finishedAt ? true : null));
  return prompts.join('\n---\n');
}

describe('the browser check line reaches the agent', () => {
  it('for interface work in a session that has the Browser pane', async () => {
    const prompt = await turnPrompt('Make the Save button wider', 'do', true);
    expect(prompt).toContain(BROWSER_CHECK_LINE);
  });

  it('not without the pane, not for an Ask turn, and not for other work', async () => {
    expect(await turnPrompt('Make the Save button wider', 'do', false)).not.toContain(
      BROWSER_CHECK_LINE,
    );
    expect(await turnPrompt('Make the Save button wider', 'ask', true)).not.toContain(
      BROWSER_CHECK_LINE,
    );
    expect(await turnPrompt('Fix the retry count in the queue', 'do', true)).not.toContain(
      BROWSER_CHECK_LINE,
    );
  });
});
