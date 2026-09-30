import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel } from '@spark-outpost/contracts';
import { SPEC_PLAN_OPTION } from '../src/orchestration/plan-first.ts';
import {
  NORMAL,
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

const SPEC_TEXT = [
  'Add notes to the divider app:',
  '- `src/notes.ts` with `addNote(text)` and `listNotes()`.',
  '- A `GET /notes` route in `src/api.ts`.',
  '- Tests in `test/notes.test.ts`. #build',
].join('\n');

const SPEC: Scenario = { ...NORMAL, id: 'spec', text: SPEC_TEXT };

async function run(level: InvolvementLevel) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: SPEC }));
  const { conversationId, runId } = await startScenario(t, root, SPEC, level);
  const done = await driveToEnd(t, conversationId, runId, undefined, 90_000);
  const children = await t.db.query<{ role: string; prompt: string }>(
    `SELECT role, prompt FROM runs WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  const plans = await t.db.query<{
    source: string;
    status: string;
    body: string;
    approved_by: string | null;
    approved_option: string | null;
  }>(
    `SELECT source, status, body, approved_by, approved_option FROM plan_documents
     WHERE conversation_id = $1 ORDER BY version`,
    [conversationId],
  );
  return {
    ...done,
    titles: done.asked.map((approval) => approval.title),
    children: children.rows,
    plans: plans.rows,
  };
}

describe('a request that is already a spec', { timeout: 120_000 }, () => {
  it('is the agreed plan at Automatic: no plan turn and no "Build this plan?" card', async () => {
    const done = await run('hands-off');
    expect(done.orchestration.status).toBe('succeeded');
    expect(done.titles).not.toContain('Build this plan?');
    expect(done.plans).toEqual([
      {
        source: 'user',
        status: 'approved',
        body: SPEC_TEXT,
        approved_by: 'user',
        approved_option: SPEC_PLAN_OPTION,
      },
    ]);
    const builder = done.children.find((child) => child.role === 'builder')!;
    expect(builder.prompt).toContain('## Agreed plan');
    expect(builder.prompt).toContain('`src/notes.ts` with `addNote(text)`');
  });

  it('still plans first at Review each step', async () => {
    const done = await run('balanced');
    expect(done.titles).toContain('Build this plan?');
    expect(done.plans.map((plan) => [plan.source, plan.status])).toEqual([['chat', 'approved']]);
  });
});
