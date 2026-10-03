import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { SPEC_PLAN_OPTION } from '../src/orchestration/plan-first.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
  NORMAL,
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

async function run(level: InvolvementLevel, scenario = SPEC, answer: Answerer = answerEverything) {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }));
  const { conversationId, runId } = await startScenario(t, root, scenario, level);
  const done = await driveToEnd(t, conversationId, runId, answer, 90_000);
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
    conversationId,
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

  it('still asks Build this plan? for a destructive spec at Automatic (live runs D and E)', async () => {
    const text = [
      'Split this up into pieces, they are independent:',
      '- Add a migration `migrations/002_tags.sql` that will drop the `old_tags` table.',
      '- Add `src/slug.ts` exporting `slugify(text)`. Add tests in `test/slug.test.ts`. #build',
    ].join('\n');
    const done = await run('hands-off', { ...NORMAL, id: 'spec-d', text });
    expect(done.orchestration.status).toBe('succeeded');
    expect(done.titles).toContain('Build this plan?');
    expect(done.plans.map((plan) => [plan.source, plan.status])).toEqual([['chat', 'approved']]);
  });
});

describe('the plan-first card at Automatic', { timeout: 120_000 }, () => {
  it('waits for Build past the auto-continue time, then builds the plan', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const loose: Scenario = {
      ...NORMAL,
      id: 'loose',
      text: 'Refactor the notes store, update the API, change the view and add tests. #build',
    };
    let firstSeen: number | null = null;
    const done = await run('hands-off', loose, (approval) => {
      if (approval.kind !== 'plan') return answerEverything(approval);
      firstSeen ??= Date.now();
      return Date.now() - firstSeen < 2_500 ? null : { optionId: CHECKPOINT_OPTION.makeChange };
    });
    expect(done.orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ decided_by: string; auto: boolean; reason: string }>(
      `SELECT a.decided_by, a.auto_continue_at IS NOT NULL AS auto, a.reason FROM approvals a
       JOIN runs r ON r.id = a.run_id WHERE r.conversation_id = $1 AND a.title = 'Build this plan?'`,
      [done.conversationId],
    );
    expect(rows).toEqual([
      {
        decided_by: 'user',
        auto: false,
        reason: 'Saved as plan v1; nothing was changed yet. Build it, edit it, or stop.',
      },
    ]);
    expect(done.plans.map((plan) => [plan.source, plan.status])).toEqual([['chat', 'approved']]);
  });
});
