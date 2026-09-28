import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { MIGRATION_CARD_REASON } from '../src/orchestration/checkpoint-policy.ts';
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

/** The developer's-day tags story (s11): its migration only adds a table. */
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

  it('asks no risky card for it at Review each step either, and no keep card after you approved each edit', async () => {
    const { orchestration, cards } = await run(`${TAGS_STORY} #build #addmigration`, 'balanced');
    expect(orchestration.status).toBe('succeeded');
    expect(cards.map((approval) => approval.kind)).toEqual([]);
    expect(
      orchestration.checkpoints.find((approval) => approval.kind === 'accept')?.payload.checkpoint
        ?.keptBy,
    ).toBe('balanced');
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder', 'critic']);
  }, 60_000);

  it('still shows the card first for a migration that drops a column at Review each step', async () => {
    const { orchestration, cards } = await run(
      'Write a migration that drops the note column from projects. #build #dropmigration',
      'balanced',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(cards[0]).toMatchObject({ kind: 'plan' });
    expect(cards[0]!.reason).toBe(MIGRATION_CARD_REASON);
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
      'Automatic asks because the migration it added can lose or rewrite existing data (`ALTER TABLE projects DROP COLUMN note`).',
    );
  }, 60_000);
});
