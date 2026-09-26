import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { runChanges, revertRun } from '../src/projects/run-changes.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import {
  SCENARIOS,
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
import { createTestDb, eventually, type TestDb } from './support.ts';

const [, TRIVIAL, , COMPLEX] = SCENARIOS as [Scenario, Scenario, Scenario, Scenario, Scenario];

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let script: JevScript;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  script = { calls: [] };
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

async function start(options: { jev?: boolean; activeLimitMs?: number } = {}) {
  await connectProviders(t, options.jev ?? true);
  harness = startOrchestrator(
    t,
    options.jev === false ? null : jevFetch(script),
    options.activeLimitMs ? { budget: { activeLimitMs: options.activeLimitMs } } : {},
  );
}

const withText = (scenario: Scenario, text: string): Scenario => ({ ...scenario, text });

async function pending(conversationId: string, kind: Approval['kind']): Promise<Approval> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.approvals.find((approval) => approval.kind === kind);
  }, 30_000);
}

async function activeBuilder(runId: string) {
  return eventually(async () => {
    const view = await loadOrchestration(t.db, runId);
    const builder = view?.crew.find((member) => member.role === 'builder');
    const notes = await readFile(join(root, 'notes.txt'), 'utf8');
    return builder?.status === 'running' && notes.includes('step 1') ? builder : null;
  }, 30_000);
}

describe('repair and escalation', () => {
  it('retries one tier up at most twice, then asks you', async () => {
    script.transition = () => ({ status: 'needs_more_work', next: 'retry_up' });
    await start();
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'hands-off');
    const answers: Answerer = (approval) =>
      approval.kind === 'retry'
        ? { optionId: CHECKPOINT_OPTION.finish }
        : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'haiku'],
      ['builder', 'sonnet'],
      ['builder', 'opus[1m]'],
    ]);
    expect(orchestration.retries).toBe(2);
    expect(asked.map((approval) => approval.kind)).toEqual(['retry']);
    expect(asked[0]!.payload.checkpoint?.reason).toBe('Stopped after 2 retries.');
    expect(orchestration.status).toBe('succeeded');
  }, 60_000);

  it('confirms a retry under Balanced when Jev is below 0.9', async () => {
    let judged = 0;
    script.transition = () =>
      judged++ === 0
        ? { status: 'needs_more_work', next: 'retry_up', confidence: 0.8 }
        : { status: 'done', next: 'finish' };
    await start();
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'balanced');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.kind)).toEqual(['edit', 'retry', 'edit', 'accept']);
    expect(asked[1]!.payload.checkpoint).toMatchObject({
      from: { model: 'haiku' },
      to: { model: 'sonnet' },
    });
    expect(orchestration.crew.map((member) => member.model)).toEqual(['haiku', 'sonnet']);
  }, 60_000);
});

describe('when Jev says the agent needs you', () => {
  it('finishes without a checkpoint when Jev is unsure after a successful Builder', async () => {
    script.transition = () => ({ status: 'needs_you', next: 'finish', confidence: 0.64 });
    await start();
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'hands-off');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(asked).toEqual([]);
    expect(orchestration).toMatchObject({ status: 'succeeded', checkpoints: [] });
    expect(orchestration.crew.map((member) => member.status)).toEqual(['succeeded']);
    const transition = orchestration.decisions.find((decision) => decision.kind === 'transition');
    expect(transition).toMatchObject({
      applied: 'rules',
      summary: 'done · next finish',
      answer: { status: 'done', next: 'finish', quality: null, jev: { status: 'needs_you' } },
    });
    expect(orchestration.crew[0]!.quality).toBeNull();
  }, 60_000);

  it('asks for your input when Jev is sure, and sends your answer to the Builder', async () => {
    let judged = 0;
    script.transition = () =>
      judged++ === 0
        ? { status: 'needs_you', next: 'finish', confidence: 0.95 }
        : { status: 'done', next: 'finish' };
    await start();
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'hands-off');
    const answers: Answerer = (approval) =>
      approval.kind === 'clarify'
        ? { optionId: CHECKPOINT_OPTION.answer, note: 'Use the staging bucket' }
        : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(asked.map((approval) => approval.kind)).toEqual(['clarify']);
    expect(asked[0]).toMatchObject({ title: 'Bolt needs your input' });
    expect(asked[0]!.payload.checkpoint).toMatchObject({ agent: 'Bolt' });
    expect(asked[0]!.payload.checkpoint?.reason).toMatch(/^Bolt is waiting for your input/);
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'haiku'],
      ['builder', 'haiku'],
    ]);
    const answered = await t.db.query<{ prompt: string }>('SELECT prompt FROM runs WHERE id = $1', [
      orchestration.crew[1]!.runId,
    ]);
    expect(answered.rows[0]!.prompt).toContain('Use the staging bucket');
  }, 60_000);
});

describe('checkpoints', () => {
  it('sends an edited plan back to the Architect, then builds from the approved plan', async () => {
    await start();
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'balanced');
    let plans = 0;
    const answers: Answerer = (approval) =>
      approval.kind === 'plan' && plans++ === 0
        ? { optionId: CHECKPOINT_OPTION.editPlan, note: 'Keep the divider untouched' }
        : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration.crew.map((member) => member.role).slice(0, 3)).toEqual([
      'architect',
      'architect',
      'builder',
    ]);
    const plansAsked = asked.filter((approval) => approval.kind === 'plan');
    expect(plansAsked).toHaveLength(2);
    const architects = await t.db.query<{ prompt: string }>(
      `SELECT prompt FROM runs WHERE parent_run_id = $1 AND role = 'architect' ORDER BY created_at`,
      [runId],
    );
    expect(architects.rows[1]!.prompt).toContain('Keep the divider untouched');
    expect(architects.rows[1]!.prompt).toContain('Your previous plan');
  }, 60_000);

  it('reverts the whole orchestration from the keep, fix or revert card', async () => {
    await start();
    const { conversationId, runId } = await startScenario(t, root, TRIVIAL, 'balanced');
    const answers: Answerer = (approval) =>
      approval.kind === 'accept'
        ? { optionId: CHECKPOINT_OPTION.revert }
        : answerEverything(approval);
    const { orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration.status).toBe('succeeded');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\n');
    expect((await getRun(t.db, runId))?.revertedAt).not.toBeNull();
  }, 60_000);

  it('stops at the time budget and asks before continuing', async () => {
    await start({ activeLimitMs: 1_500 });
    const scenario = withText(COMPLEX, `${COMPLEX.text} #slowbuild`);
    script.scenario = COMPLEX;
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const answers: Answerer = (approval) =>
      approval.kind === 'budget'
        ? { optionId: CHECKPOINT_OPTION.stop }
        : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(asked.map((approval) => approval.kind)).toEqual(['budget']);
    expect(asked[0]!.payload.checkpoint?.budget).toMatchObject({ limit: 'time', allowed: 1_500 });
    expect(orchestration).toMatchObject({ status: 'failed', budget: { exceeded: 'time' } });
    expect(orchestration.crew.at(-1)?.status).toBe('cancelled');
  }, 60_000);
});

describe('routing', () => {
  it('uses the pinned model for workers and records what Auto would have used', async () => {
    await start();
    const pinned = { ...COMPLEX };
    const { conversationId, runId } = await startScenario(t, root, pinned, 'hands-off', 'pinned');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    const [architect, builder] = orchestration.crew;
    expect(architect).toMatchObject({
      model: 'sonnet',
      effort: 'high',
      routedBy: 'pinned',
      autoWouldUse: { model: 'opus[1m]', effort: 'high' },
    });
    expect(builder).toMatchObject({
      model: 'sonnet',
      routedBy: 'pinned',
      autoWouldUse: { model: 'sonnet' },
    });
    expect(orchestration.crew.at(-1)).toMatchObject({ role: 'critic', provider: 'codex' });
  }, 60_000);

  it('falls back to the rules without Jev: a Do request runs one Builder', async () => {
    await start({ jev: false });
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration).toMatchObject({ depth: 'execute', depthSource: 'rules' });
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
    expect(orchestration.totals.jevCalls).toBe(0);
    expect(orchestration.decisions.map((decision) => decision.applied)).toEqual([
      'rules',
      'rules',
      'rules',
    ]);
  }, 60_000);
});

describe('stop and recovery', () => {
  it('stops the active Builder when you press Stop', async () => {
    await start();
    script.scenario = COMPLEX;
    const scenario = withText(COMPLEX, `${COMPLEX.text} #slowbuild`);
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const builder = await activeBuilder(runId);
    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('cancelled');
    expect(await getRun(t.db, builder.runId)).toMatchObject({ status: 'cancelled' });
    expect(orchestration.crew.map((member) => member.role)).toEqual(['architect', 'builder']);
  }, 60_000);

  it('marks the orchestration and its active child outcome unknown after a crash', async () => {
    await start();
    script.scenario = COMPLEX;
    const scenario = withText(COMPLEX, `${COMPLEX.text} #slowbuild`);
    const { runId } = await startScenario(t, root, scenario, 'hands-off');
    const builder = await activeBuilder(runId);
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    expect(await recoverExpiredLeases(t.db)).toBe(2);
    const orchestration = await eventually(async () => {
      const view = await loadOrchestration(t.db, runId);
      return view?.status === 'outcome_unknown' ? view : null;
    });
    expect(orchestration.phase).toBe('finished');
    expect(await getRun(t.db, builder.runId)).toMatchObject({ status: 'outcome_unknown' });
    const changes = await runChanges(t.db, t.workspaceId, runId);
    expect(changes).toMatchObject({
      revertible: true,
      files: [{ path: 'notes.txt', change: 'modified' }],
    });
    await revertRun(t.db, t.workspaceId, runId);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\n');
  }, 60_000);

  it('expires a pending checkpoint when the worker crashes while waiting', async () => {
    await start();
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'balanced');
    const plan = await pending(conversationId, 'plan');
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    await recoverExpiredLeases(t.db);
    const view = await loadOrchestration(t.db, runId);
    expect(view?.status).toBe('outcome_unknown');
    expect(view?.checkpoints.find((checkpoint) => checkpoint.id === plan.id)).toMatchObject({
      status: 'expired',
      decidedBy: 'recovery',
    });
    expect(view?.pendingCheckpoint).toBeNull();
  }, 60_000);
});
