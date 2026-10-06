import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION } from '@spark-outpost/contracts';
import {
  TRIVIAL,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  withTag,
  type Answerer,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const SLOW_POLL_MS = 3_000;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

const stopAtCard: Answerer = (approval) =>
  approval.kind === 'stuck' ? { optionId: CHECKPOINT_OPTION.stop } : answerEverything(approval);

describe('stopping a Builder in-process', () => {
  it('refuses an edit the Builder asks for after the loop guard tripped', async () => {
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: TRIVIAL }), {
      cancelPollMs: SLOW_POLL_MS,
    });
    const looping = withTag(TRIVIAL, '#loopedit');
    const { conversationId, runId } = await startScenario(t, root, looping, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId, stopAtCard);
    expect(orchestration.crew[0]?.status).toBe('cancelled');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).not.toContain('after the loop');
  }, 60_000);
});
