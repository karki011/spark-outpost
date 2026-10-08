import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_OPTION, type Approval } from '@spark-outpost/contracts';
import { getConversationDetail, getSummary } from '../src/persistence/conversations.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { providerIssues } from '../src/persistence/provider-health.ts';
import { getRun, requestCancel } from '../src/persistence/runs.ts';
import { runChanges, revertRun } from '../src/projects/run-changes.ts';
import { recoverExpiredLeases } from '../src/workflow/recovery.ts';
import {
  COMPLEX,
  NORMAL,
  TRIVIAL,
  answerEverything,
  assistantReplies,
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

async function start(options: { jev?: boolean } = {}) {
  await connectProviders(t, options.jev ?? true);
  harness = startOrchestrator(t, options.jev === false ? null : jevFetch(script));
}

async function pending(conversationId: string, kind: Approval['kind']): Promise<Approval> {
  return eventually(async () => {
    const detail = await getConversationDetail(t.db, conversationId);
    return detail?.approvals.find(
      (approval) => approval.kind === kind && approval.status === 'pending',
    );
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
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.crew.map((member) => [member.role, member.model])).toEqual([
      ['builder', 'sonnet'],
      ['builder', 'opus[1m]'],
      ['builder', 'opus[1m]'],
    ]);
    expect(orchestration.retries).toBe(2);
    expect(asked).toEqual([]);
    expect(orchestration.checkpoints.map((checkpoint) => checkpoint.kind)).not.toContain('retry');
    expect((await assistantReplies(t, runId)).at(-1)).toMatch(
      /Needs you: Stopped after 2 retries\.$/,
    );
    expect(orchestration.status).toBe('succeeded');
    expect((await getSummary(t.db, conversationId))?.latestRun).toMatchObject({
      status: 'succeeded',
      needsYou: 'Needs you: Stopped after 2 retries.',
    });
  }, 60_000);

  it('says a signed-out provider plainly, once, and does not retry on it', async () => {
    await start();
    script.scenario = TRIVIAL;
    const signedOut = withTag(TRIVIAL, '#signedout');
    const { conversationId, runId } = await startScenario(t, root, signedOut, 'hands-off');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    const message =
      "Claude couldn't sign in (Sign in to continue using Claude.). Open Settings, reconnect Claude, and try again.";
    expect(asked).toEqual([]);
    expect(orchestration.crew.map((member) => [member.role, member.status])).toEqual([
      ['builder', 'failed'],
    ]);
    expect(orchestration.retries).toBe(0);
    expect(orchestration.status).toBe('failed');
    expect((await getRun(t.db, runId))?.error).toBe(message);
    expect((await assistantReplies(t, runId)).at(-1)).toContain(message);
    expect(await providerIssues(t.db, t.workspaceId)).toMatchObject([
      { provider: 'claude', kind: 'auth', message },
    ]);
  }, 60_000);

  it('recovers from one failure by retrying one tier up without asking', async () => {
    await start();
    script.scenario = TRIVIAL;
    const flaky = withTag(TRIVIAL, '#failonce 1');
    const { conversationId, runId } = await startScenario(t, root, flaky, null);
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.kind)).toEqual(['edit']);
    expect(orchestration.crew.map((member) => member.model)).toEqual(['sonnet', 'opus[1m]']);
    expect(orchestration.status).toBe('succeeded');
  }, 60_000);
});

describe('the loop guard', () => {
  it.each(['hands-off', 'full-auto'] as const)(
    'stops with a report at %s',
    async (level) => {
      await start();
      script.scenario = TRIVIAL;
      const looping = withTag(TRIVIAL, '#repeat');
      const { conversationId, runId } = await startScenario(t, root, looping, level);
      const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
      expect(asked).toEqual([]);
      expect(orchestration.status).toBe('failed');
      expect(orchestration.error).toMatch(/^Stopped: Bolt repeated/);
    },
    60_000,
  );
});

describe('checkpoints', () => {
  it('reverts the whole orchestration from the keep, fix or revert card', async () => {
    await start();
    const risky = withTag(TRIVIAL, '#dropmigration');
    const { conversationId, runId } = await startScenario(t, root, risky, 'hands-off');
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
    const risky = withTag(TRIVIAL, '#dropmigration');
    const { conversationId, runId } = await startScenario(t, root, risky, 'hands-off');
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

  it('runs past 60 tool calls and rising cost without stopping to ask', async () => {
    await start();
    const scenario = withTag(COMPLEX, '#meter');
    script.scenario = COMPLEX;
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId);
    expect(asked.map((approval) => approval.kind)).not.toContain('budget');
    expect(orchestration.status).toBe('succeeded');
    expect(orchestration.usage?.toolCalls).toBeGreaterThan(60);
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
    const route = orchestration.decisions.find(
      (decision) => decision.kind === 'route' && decision.childRunId !== null,
    );
    expect(route?.summary).toContain('Jev would have used Opus 5.5');
  }, 60_000);

  it("keeps a pinned chat's Builder on the pin when Jev rates the work clearly simple", async () => {
    await start();
    const simple = { ...NORMAL, id: 'simple', ratings: { complexity: 1, stakes: 1 } };
    script.scenario = simple;
    const run = await startScenario(t, root, simple, 'hands-off', 'pinned', 'opus[1m]');
    const { orchestration } = await driveToEnd(t, run.conversationId, run.runId);
    expect(orchestration.crew).toEqual([
      expect.objectContaining({ role: 'builder', model: 'opus[1m]', routedBy: 'pinned' }),
    ]);
  }, 60_000);

  it('falls back to the rules without Jev: a Do request runs one Builder', async () => {
    await start({ jev: false });
    const { conversationId, runId } = await startScenario(t, root, COMPLEX, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration).toMatchObject({ depth: 'execute', depthSource: 'rules' });
    expect(orchestration.crew.map((member) => member.role)).toEqual(['builder']);
    expect(orchestration.totals.jevCalls).toBe(0);
    expect(
      orchestration.decisions.map((decision) => [
        decision.kind,
        decision.applied,
        decision.childRunId,
      ]),
    ).toEqual([
      ['intake', 'rules', null],
      ['route', 'rules', null],
      ['route', 'rules', orchestration.crew[0]!.runId],
    ]);
    expect(orchestration.decisions[1]!.summary).toBe('intake read this as build');
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
    const risky = withTag(TRIVIAL, '#dropmigration');
    const { conversationId, runId } = await startScenario(t, root, risky, 'hands-off');
    const keep = await pending(conversationId, 'accept');
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
