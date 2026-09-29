import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateProfile } from '../src/persistence/setup.ts';
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

describe('Critic settings', () => {
  it('sends risky work to a Critic on the other connected provider by default', async () => {
    expect(await crew()).toContainEqual(['critic', 'codex']);
  }, 60_000);

  it('keeps the Critic on the chat’s provider when you turn that off', async () => {
    await updateProfile(t.db, t.workspaceId, { criticOtherProvider: false });
    expect(await crew()).toContainEqual(['critic', 'claude']);
  }, 60_000);

  it('skips the Critic when you turn it off', async () => {
    await updateProfile(t.db, t.workspaceId, { criticEnabled: false });
    const members = await crew();
    expect(members.map(([role]) => role)).not.toContain('critic');
    expect(members.map(([role]) => role)).toContain('builder');
  }, 60_000);
});
