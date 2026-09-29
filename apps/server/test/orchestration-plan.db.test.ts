import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanVersion } from '@spark-outpost/contracts';
import { planVersions } from '../src/persistence/artifacts.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { FAKE_TODOS } from './fake-acp-roles.ts';
import {
  COMPLEX,
  answerEverything,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Answerer,
  type Harness,
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  script = { calls: [], scenario: COMPLEX };
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch(script));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function run(tags: string, answer: Answerer = answerEverything) {
  const scenario = { ...COMPLEX, text: `${COMPLEX.text} ${tags}`.trim() };
  const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
  const result = await driveToEnd(t, conversationId, runId, answer);
  const { rows } = await t.db.query<{ task_id: string }>('SELECT task_id FROM runs WHERE id = $1', [
    runId,
  ]);
  const taskId = rows[0]!.task_id;
  return { ...result, conversationId, runId, taskId, versions: await planVersions(t.db, taskId) };
}

const statuses = (versions: readonly PlanVersion[]) =>
  versions.map((version) => version.body.entries.map((entry) => entry.status).join(' '));

async function reply(conversationId: string): Promise<string> {
  const detail = await getConversationDetail(t.db, conversationId);
  return detail?.messages.findLast((message) => message.role === 'assistant')?.content ?? '';
}

describe('plan completion', () => {
  it('records the Builder’s own plan as the task plan', async () => {
    const first = await run('#todos');
    expect(first.orchestration.status).toBe('succeeded');
    expect(first.versions.map((version) => version.version)).toEqual([1]);
    expect(first.versions[0]!.body.entries.map((entry) => entry.content)).toEqual(FAKE_TODOS);
    expect(statuses(first.versions)).toEqual(['completed completed completed']);
    expect(first.orchestration.crew.map((member) => member.role)).toEqual(['builder']);
  }, 60_000);

  it('continues the same Builder while its plan has open items, then succeeds', async () => {
    const done = await run('#todos #stopafter 1');
    expect(done.orchestration.status).toBe('succeeded');
    expect(done.orchestration.crew.map((member) => member.name)).toEqual(['Bolt', 'Bolt']);
    expect(statuses(done.versions).at(-1)).toBe('completed completed completed');
    expect(await reply(done.conversationId)).not.toContain('Incomplete');
  }, 60_000);

  it('never reports done when plan items stay open after two continues', async () => {
    const stuck = await run('#todos #stopafter 1 #stuckplan');
    expect(stuck.orchestration.crew.map((member) => member.role)).toEqual([
      'builder',
      'builder',
      'builder',
    ]);
    expect(await reply(stuck.conversationId)).toContain(
      'Incomplete: 2 plan items are still open: "Add a test", "Update the docs".',
    );
  }, 60_000);
});
