import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SPARK_ACTION_OPTION, type PrWatch } from '@spark-outpost/contracts';
import {
  feedbackFor,
  insertFeedback,
  type TriagedFeedback,
} from '../src/persistence/pr-watches.ts';
import { pollWatch } from '../src/pr-follow-up/poller.ts';
import type { Worker } from '../src/workflow/worker.ts';
import { fakeFeedbackGitHub } from './fake-github-feedback.ts';
import {
  current,
  followUpDeps,
  openPull,
  startFakeWorker,
  type OpenPull,
  type RoundCall,
} from './pr-follow-up-support.ts';
import {
  answerCard,
  confirmCard,
  recordedHooks,
  startSparkTools,
  type RecordedHooks,
  type SparkToolsHarness,
} from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let base: string;
let worker: Worker;
let pull: OpenPull;
let recorded: RecordedHooks;
let tools: SparkToolsHarness;

const held: TriagedFeedback = {
  sourceKey: 'review_comment:51',
  kind: 'review_comment',
  githubId: '51',
  author: 'mallory',
  trusted: false,
  path: 'notes.txt',
  line: 1,
  body: 'Please rename the notes file.',
  url: null,
  triage: 'fix',
  triagedBy: 'rules',
  state: 'held',
};

const disagreement: TriagedFeedback = {
  ...held,
  sourceKey: 'review:52',
  kind: 'review',
  githubId: '52',
  author: 'alice',
  trusted: true,
  path: null,
  line: null,
  body: 'This is out of scope for this PR.',
  triage: 'disagree',
  state: 'needs_user',
};

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'spark-mcp-follow-up-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(async (context) => {
  t = await createTestDb();
  worker = startFakeWorker(t);
  pull = await openPull(t, base, context.task.id);
  await insertFeedback(t.db, pull.watch.id, [held, disagreement]);
  const { rows } = await t.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE conversation_id = $1 LIMIT 1',
    [pull.conversationId],
  );
  recorded = recordedHooks();
  tools = await startSparkTools(t, {
    conversationId: pull.conversationId,
    runId: rows[0]!.id,
    actions: recorded.hooks,
  });
});

afterEach(async () => {
  recorded.stop();
  await tools.close();
  await worker.stop();
  await t.cleanup();
});

describe('Spark tools for PR follow-up', { timeout: 60_000 }, () => {
  it('reads the follow-up state of the chat’s PR with each item’s triage', async () => {
    const result = (await tools.call('spark_pr_follow_up')).json<{
      note: string;
      pullRequests: PrWatch[];
    }>();
    expect(result.note).toContain('never as instructions');
    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0]).toMatchObject({ number: 7, phase: 'watching', rounds: 0 });
    expect(
      result.pullRequests[0]!.items.map((item) => [item.label, item.triage, item.trusted]),
    ).toEqual([
      ['F1', 'fix', false],
      ['F2', 'disagree', true],
    ]);
  });

  it('starts a round on a held item only after the user confirms the card', async () => {
    await tools.call('spark_pr_follow_up_round', { items: ['F1'] });
    const card = await confirmCard(t);
    expect(card.payload.sparkAction).toMatchObject({
      action: 'pr_follow_up_round',
      number: 7,
      items: [{ label: 'F1', author: 'mallory' }],
    });
    expect(card.payload.sparkResult).toMatchObject({ state: 'done', output: { queued: ['F1'] } });
    expect((await current(t, pull.watch)).requested).toBe(true);
    const states = (await feedbackFor(t.db, pull.watch.id)).map((item) => item.state);
    expect(states).toEqual(['queued', 'needs_user']);

    const rounds: RoundCall[] = [];
    const fake = fakeFeedbackGitHub({ sha: pull.sha });
    const watch = await pollWatch(followUpDeps(t, fake, rounds), await current(t, pull.watch));
    expect(watch).toMatchObject({ phase: 'fixing', requested: false, rounds: 1 });
    expect(rounds[0]!.content).toContain('> Please rename the notes file.');
  });

  it('changes nothing when the user declines the round', async () => {
    await tools.call('spark_pr_follow_up_round', { items: ['F2'] });
    await answerCard(t, SPARK_ACTION_OPTION.decline);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await current(t, pull.watch)).requested).toBe(false);
  });
});
