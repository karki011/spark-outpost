import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import {
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const TAGS_STORY =
  'Add tags to projects, end to end. Database: a new migration that stores tags per project. Existing databases must upgrade and their projects start with no tags. API: PUT /projects/:id/tags replaces the tags. Add tests for each part.';

const scenario = (text: string, destructive = 0.03): Scenario => ({
  id: 'migration',
  text,
  mode: 'do',
  question: 0.02,
  destructive,
  tier: 'mid',
});

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

async function run(text: string, level: InvolvementLevel, destructive?: number) {
  const played = scenario(text, destructive);
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: played }));
  const { conversationId, runId } = await startScenario(t, root, played, level);
  const done = await driveToEnd(t, conversationId, runId);
  const cards = done.asked.filter((approval) => approval.kind !== 'edit');
  return { ...done, cards };
}

describe('the risky card and migrations (N3)', () => {
  it('builds the s11 tags story (CREATE TABLE) at Auto-edit without the risky card, and the Critic still reviews it', async () => {
    const { orchestration, cards } = await run(`${TAGS_STORY} #build #addmigration`, 'hands-off');
    expect(orchestration.status).toBe('succeeded');
    expect(cards).toEqual([]);
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder', 'critic']);
    const kept = orchestration.checkpoints.find((approval) => approval.kind === 'accept');
    expect(kept?.decidedBy).toBe('level');
  }, 60_000);

  it('builds a column drop in a worktree copy at Automatic and asks to keep it instead', async () => {
    const { orchestration, cards } = await run(
      'Write a migration that drops the note column from projects. #build #dropmigration',
      'hands-off',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(cards.map((approval) => approval.kind)).toEqual(['accept']);
    expect(cards[0]!.reason).toContain('Automatic asks because the migration it added');
  }, 60_000);

  it('reads the migration diff: an additive-sounding request whose migration drops a column asks to keep at Auto-edit', async () => {
    const { orchestration, cards } = await run(
      'Add a migration for the project notes cleanup. #build #dropmigration',
      'hands-off',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(cards.map((approval) => approval.kind)).toEqual(['accept']);
    expect(cards[0]!.reason).toContain(
      'Automatic asks because the migration it added can lose or rewrite existing data (`ALTER TABLE projects DROP COLUMN note`) and the change is in your checkout, not a worktree.',
    );
  }, 60_000);
});
