import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type InvolvementLevel } from '@spark-outpost/contracts';
import { updateProfile } from '../src/persistence/setup.ts';
import {
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
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const scenario = (marker: string, depth: Scenario['depth'] = 'execute'): Scenario => ({
  id: marker,
  text: `The divider shows the wrong day after midnight. Fix it. #build ${marker}`,
  mode: 'do',
  depth,
  risk: 'edits',
  confidence: 0.92,
  model: 'sonnet',
  effort: 1,
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

const leaveStuck: Answerer = (approval) =>
  approval.kind === 'stuck' ? null : answerEverything(approval);

async function run(
  marker: string,
  level: InvolvementLevel,
  script: Partial<JevScript>,
  depth: Scenario['depth'] = 'execute',
) {
  const planned = scenario(marker, depth);
  const full = { calls: [], scenario: planned, ...script };
  harness = startOrchestrator(t, jevFetch(full));
  const { conversationId, runId } = await startScenario(t, root, planned, level);
  const done = await driveToEnd(t, conversationId, runId, leaveStuck);
  const watchdog = done.orchestration.decisions.filter((decision) => decision.kind === 'watchdog');
  return { ...done, runId, watchdog, jevCalls: full.calls };
}

async function childTexts(runId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ content: string }>(
    `SELECT m.content FROM messages m JOIN runs r ON r.id = m.run_id
     WHERE (r.id = $1 OR r.parent_run_id = $1) AND m.role = 'assistant'`,
    [runId],
  );
  return rows.map((row) => row.content);
}

describe('the Jev watchdog', () => {
  it('asks you about a looping Builder at Balanced and lets it continue on the auto-continue', async () => {
    await updateProfile(t.db, t.workspaceId, { autoContinueSeconds: 1 });
    const { orchestration, watchdog, jevCalls } = await run('#loop', 'balanced', {
      watchdog: { repeating: 0.95 },
    });
    expect(orchestration.status).toBe('succeeded');
    const stuck = orchestration.checkpoints.filter((approval) => approval.kind === 'stuck');
    expect(stuck[0]).toMatchObject({
      title: 'Bolt looks stuck',
      decidedBy: 'auto',
      decisionOptionId: CHECKPOINT_OPTION.letContinue,
    });
    expect(stuck[0]!.payload.checkpoint).toMatchObject({
      kind: 'stuck',
      agent: 'Bolt',
      reason: 'Bolt looks stuck: repeating Read src/dates.ts.',
    });
    expect(stuck[0]!.options.map((option) => option.name)).toEqual([
      'Nudge Bolt',
      'Let it continue',
      'Stop',
    ]);
    expect(watchdog[0]).toMatchObject({
      applied: 'jev',
      jevStatus: 'answered',
      answer: { flagged: true, reason: 'repeating', action: 'checkpoint', trigger: 'tool_calls' },
    });
    expect(watchdog[0]!.summary).toContain('Bolt looks stuck: repeating Read src/dates.ts');
    const asked = jevCalls.find((call) => call.questions.includes('repeating'))!;
    expect(asked.questions).toEqual(['repeating', 'off_step', 'waiting', 'finished']);
    expect(asked.state.recent).toContain('read: Read `src/dates.ts`');
    expect(orchestration.totals.jevCalls).toBeGreaterThanOrEqual(watchdog.length);
  }, 60_000);

  it('nudges a looping Builder at Full auto, never stops it, and delivers the nudge on its next turn', async () => {
    const { orchestration, watchdog, runId } = await run(
      '#loop',
      'full-auto',
      { watchdog: { repeating: 0.95 }, stepOpen: 0.9 },
      'plan_execute',
    );
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.checkpoints.some((approval) => approval.kind === 'stuck')).toBe(false);
    expect(watchdog[0]).toMatchObject({ answer: { flagged: true, action: 'nudge' } });
    const texts = await childTexts(runId);
    expect(texts.some((text) => text.includes('Heard the nudge.'))).toBe(true);
    const { rows } = await t.db.query<{ nudge: string }>(
      `SELECT route->>'nudge' AS nudge FROM runs WHERE parent_run_id = $1 AND route ? 'nudge'`,
      [runId],
    );
    expect(rows[0]?.nudge).toContain('You seemed to be repeating Read src/dates.ts.');
  }, 60_000);

  it('records a healthy Builder as fine and takes no action', async () => {
    const { orchestration, watchdog } = await run('#busy', 'balanced', {
      watchdog: { repeating: 0.05 },
    });
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.checkpoints.some((approval) => approval.kind === 'stuck')).toBe(false);
    expect(watchdog).toHaveLength(1);
    expect(watchdog[0]).toMatchObject({
      applied: 'jev',
      answer: { flagged: false, action: 'none' },
    });
    expect(watchdog[0]!.summary).toBe('Bolt looks fine (Jev 0.05; rule: fine, no obvious repeat)');
  }, 60_000);
});
