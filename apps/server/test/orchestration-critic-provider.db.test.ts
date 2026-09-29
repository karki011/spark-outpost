import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RISKY,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await connectProviders(t);
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: RISKY }));
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function crew() {
  const { conversationId, runId } = await startScenario(t, root, RISKY, 'hands-off');
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  return orchestration.crew.map((member) => [member.role, member.provider]);
}

describe('Critic provider', () => {
  it('sends risky work to a Critic on the other connected provider', async () => {
    expect(await crew()).toContainEqual(['critic', 'codex']);
  }, 60_000);
});
