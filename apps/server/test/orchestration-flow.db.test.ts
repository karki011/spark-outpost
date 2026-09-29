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
  COMPLEX,
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
  type JevScript,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

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
  it('retries a failed Builder one tier up twice by rule, then stops and reports by default', async () => {
    await start();
    script.scenario = TRIVIAL;
    const failing = withTag(TRIVIAL, '#failstep 1');
    const { conversationId, runId } = await startScenario(t, root, failing, 'hands-off');
    const answers: Answerer = (approval) =>
      approval.kind === 'retry'
        ? { optionId: CHECKPOINT_OPTION.stopReport }
        : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'sonnet'],
      ['builder', 'opus[1m]'],
      ['builder', 'opus[1m]'],
    ]);
    expect(orchestration.retries).toBe(2);
    expect(asked.map((approval) => approval.kind)).toEqual(['retry']);
    expect(asked[0]!.payload.checkpoint).toMatchObject({
      reason: 'Stopped after 2 retries.',
      autoOption: CHECKPOINT_OPTION.stopReport,
    });
    expect(orchestration.status).toBe('failed');
  }, 60_000);

  it('recovers from one failure by retrying one tier up without asking', async () => {
    await start();
    script.scenario = TRIVIAL;
    const flaky = withTag(TRIVIAL, '#failonce 1');
    const { conversationId, runId } = await startScenario(t, root, flaky, 'balanced');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.kind)).toEqual(['edit']);
    expect(orchestration.crew.map((member) => member.model)).toEqual(['sonnet', 'opus[1m]']);
    expect(orchestration.status).toBe('succeeded');
  }, 60_000);
});

describe('the loop guard', () => {
  it('stops a Builder that repeats itself and asks at Balanced; Continue resumes with a note', async () => {
    await start();
    script.scenario = TRIVIAL;
    const looping = withTag(TRIVIAL, '#repeat');
    const { conversationId, runId } = await startScenario(t, root, looping, 'balanced');
    const answers: Answerer = (approval) =>
      approval.kind === 'stuck'
        ? { optionId: CHECKPOINT_OPTION.continueStuck }
        : answerEverything(approval);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(asked.map((approval) => approval.kind)).toEqual(['stuck', 'edit']);
    expect(asked[0]!.payload.checkpoint?.reason).toContain('repeated `Read `src/dates.ts``');
    expect(orchestration.crew.map((member) => member.status)).toEqual(['cancelled', 'succeeded']);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toContain('tried another way');
  }, 60_000);

  it('stops with a report at Full auto', async () => {
    await start();
    script.scenario = TRIVIAL;
    const looping = withTag(TRIVIAL, '#repeat');
    const { conversationId, runId } = await startScenario(t, root, looping, 'full-auto');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(asked).toEqual([]);
    expect(orchestration.status).toBe('failed');
    expect(orchestration.error).toMatch(/^Stopped: Bolt repeated/);
  }, 60_000);
});

describe('checkpoints', () => {
  it('reverts the whole orchestration from the keep, fix or revert card', async () => {
    await start();
    const { conversationId, runId } = await startScenario(
      t,
      root,
      TRIVIAL,
      'balanced',
      'auto',
      'sonnet',
      'acceptEdits',
    );
    const answers: Answerer = (approval) =>
      approval.kind === 'accept'
        ? { optionId: CHECKPOINT_OPTION.revert }
        : answerEverything(approval);
    const { orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration.status).toBe('succeeded');
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toBe('start\n');
    expect((await getRun(t.db, runId))?.revertedAt).not.toBeNull();
  }, 60_000);

  it('sends a fix request back to the same Builder from the keep card', async () => {
    await start();
    const { conversationId, runId } = await startScenario(
      t,
      root,
      TRIVIAL,
      'balanced',
      'auto',
      'sonnet',
      'acceptEdits',
    );
    let fixed = false;
    const answers: Answerer = (approval) => {
      if (approval.kind !== 'accept') return answerEverything(approval);
      if (fixed) return { optionId: CHECKPOINT_OPTION.keep };
      fixed = true;
      return { optionId: CHECKPOINT_OPTION.fix, note: 'Use UTC' };
    };
    const { orchestration } = await driveToEnd(t, conversationId, runId, answers);
    expect(orchestration.crew.map((member) => member.name)).toEqual(['Bolt', 'Bolt']);
    expect(await readFile(join(root, 'notes.txt'), 'utf8')).toContain('fixed as asked');
  }, 60_000);

  it('stops at the time budget and asks before continuing', async () => {
    await start({ activeLimitMs: 1_500 });
    const scenario = withTag(COMPLEX, '#slowbuild');
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
  it('uses the pinned model and records the tier Jev would have used', async () => {
    await start();
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'hands-off', 'pinned');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.crew).toEqual([
      expect.objectContaining({
        role: 'builder',
        model: 'sonnet',
        routedBy: 'pinned',
        autoWouldUse: expect.objectContaining({ model: 'opus[1m]' }),
      }),
    ]);
    const route = orchestration.decisions.find((decision) => decision.kind === 'route');
    expect(route?.summary).toContain('Jev would have used Opus 5.5');
  }, 60_000);

  it('falls back to the rules without Jev: a Do request runs one Builder', async () => {
    await start({ jev: false });
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration).toMatchObject({ depth: 'execute', depthSource: 'rules' });
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
    expect(orchestration.totals.jevCalls).toBe(0);
    expect(orchestration.decisions.map((decision) => [decision.kind, decision.applied])).toEqual([
      ['intake', 'rules'],
      ['route', 'rules'],
    ]);
  }, 60_000);
});

describe('stop and recovery', () => {
  it('stops the active Builder when you press Stop', async () => {
    await start();
    script.scenario = COMPLEX;
    const scenario = withTag(COMPLEX, '#slowbuild');
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const builder = await activeBuilder(runId);
    await requestCancel(t.db, runId);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('cancelled');
    expect(await getRun(t.db, builder.runId)).toMatchObject({ status: 'cancelled' });
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
  }, 60_000);

  it('marks the orchestration and its active child outcome unknown after a crash', async () => {
    await start();
    script.scenario = COMPLEX;
    const scenario = withTag(COMPLEX, '#slowbuild');
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
    const vague = { ...TRIVIAL, text: 'Make the reports better', vague: 0.95 };
    script.scenario = vague;
    const { conversationId, runId } = await startScenario(t, root, vague, 'balanced');
    const keep = await pending(conversationId, 'clarify');
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    await recoverExpiredLeases(t.db);
    const view = await loadOrchestration(t.db, runId);
    expect(view?.status).toBe('outcome_unknown');
    expect(view?.checkpoints.find((checkpoint) => checkpoint.id === keep.id)).toMatchObject({
      status: 'expired',
      decidedBy: 'recovery',
    });
    expect(view?.pendingCheckpoint).toBeNull();
  }, 60_000);
});
