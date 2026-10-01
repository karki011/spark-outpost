import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_OPTION,
  type CheckBody,
  type InvolvementLevel,
  type PieceList,
} from '@spark-outpost/contracts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { PIECE_OUTCOME_UNKNOWN, recoverExpiredLeases } from '../src/workflow/recovery.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import { BLIND_FINDING } from './fake-acp-roles.ts';
import {
  NORMAL,
  answerEverything,
  artifactBodies,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  setCheckCommands,
  startOrchestrator,
  startScenario,
  withTag,
  type Answerer,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const FAILS_UNTIL_FIXED = `import { existsSync } from 'node:fs';
if (!existsSync('fixed.txt')) {
  console.error('expected fixed.txt to exist');
  process.exit(1);
}
`;

let t: TestDb;
let root: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(join(root, 'piece-check.mjs'), PIECE_CHECK_SCRIPT);
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
});

interface Child {
  role: string;
  name: string;
  pieceKey: string | null;
  resumeKey: string | null;
  prompt: string;
  status: string;
}

async function children(runId: string): Promise<Child[]> {
  const { rows } = await t.db.query<{
    role: string;
    route: Record<string, string>;
    prompt: string;
    status: string;
  }>(`SELECT role, route, prompt, status FROM runs WHERE parent_run_id = $1 ORDER BY created_at`, [
    runId,
  ]);
  return rows.map((row) => ({
    role: row.role,
    name: row.route.name ?? '',
    pieceKey: row.route.pieceKey ?? null,
    resumeKey: row.route.resumeKey ?? null,
    prompt: row.prompt,
    status: row.status,
  }));
}

async function begin(tags: string, level: InvolvementLevel = 'hands-off') {
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
    coordinator: 'in_order',
  });
  const scenario = withTag(NORMAL, `Split this up. ${tags}`);
  return startScenario(t, root, scenario, level, 'auto', 'sonnet', 'acceptEdits');
}

async function pieceList(runId: string): Promise<PieceList> {
  const view = await loadOrchestration(t.db, runId);
  const list = await currentPieceList(t.db, view!.taskId!);
  return list!;
}

describe('pieces in order', { timeout: 120_000 }, () => {
  it('records the Hofstadter estimate when a split run skips the plan card (C2)', async () => {
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL }), {
      coordinator: 'in_order',
    });
    const scenario = { ...NORMAL, text: 'Split this up into pieces. #build #pieces' };
    const started = await startScenario(
      t,
      root,
      scenario,
      'hands-off',
      'auto',
      'sonnet',
      'acceptEdits',
    );
    const { asked, orchestration } = await driveToEnd(
      t,
      started.conversationId,
      started.runId,
      undefined,
      90_000,
    );
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.title)).not.toContain('Build this plan?');
    expect((await children(started.runId)).some((child) => child.pieceKey)).toBe(true);
    const { rows } = await t.db.query<{ body: { answer: { law: string } } }>(
      `SELECT body FROM run_advice WHERE run_id = $1 AND purpose = 'law'`,
      [started.runId],
    );
    expect(rows.filter((row) => row.body.answer.law === 'estimate')).toHaveLength(1);
  });

  it('plans first, then splits the agreed plan into pieces and lands them in dependency order', async () => {
    const { conversationId, runId } = await begin('#pieces');
    const { asked, orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    expect(asked.map((approval) => approval.title)).toContain('Build this plan?');
    const crew = await children(runId);
    const pieces = crew.filter((child) => child.pieceKey);
    expect(crew[0]).toMatchObject({ role: 'coordinator', name: 'Atlas' });
    expect(crew[0]!.prompt).toContain('## Agreed plan');
    expect(crew[0]!.prompt).toContain('Store: build it in `store.ts`');
    expect(pieces.map((child) => [child.role, child.pieceKey, child.name])).toEqual([
      ['builder', 'P1', 'Bolt'],
      ['builder', 'P2', 'Rivet'],
      ['builder', 'P3', 'Tack'],
    ]);
    expect(pieces[1]!.resumeKey).toMatch(/:piece:P2$/);
    expect(pieces[1]!.prompt).toContain('- P1 · Store: store.ts');
    const list = await pieceList(runId);
    expect(list).toMatchObject({
      version: 1,
      planVersion: 1,
      placement: 'in_order',
      status: 'approved',
    });
    expect(list.pieces.map((piece) => [piece.key, piece.status, piece.check])).toEqual([
      ['P1', 'landed', 'passed'],
      ['P2', 'landed', 'passed'],
      ['P3', 'landed', 'passed'],
    ]);
    expect(list.pieces.map((piece) => piece.filesChanged)).toEqual([
      ['store.ts'],
      ['api.ts'],
      ['view.ts'],
    ]);
    expect(orchestration.pieces?.id).toBe(list.id);
    expect(orchestration.crew.find((member) => member.pieceKey === 'P3')?.placement).toBe(
      'in_order',
    );
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain('Pieces (3, in order, list v1)');
    expect(reply).toContain('| P2 · API | Rivet | in order |');
    expect(reply).toMatch(
      /^Built in 3 pieces:\n- P1 · Store \(Bolt\): Built P1 in store\.ts\. Files: `store\.ts`\. Scoped check: \w+\.\n- P2 · API \(Rivet\): Built P2 in api\.ts\. Files: `api\.ts`\. Scoped check: \w+\.\n- P3 · View \(Tack\): Built P3 in view\.ts\. Files: `view\.ts`\. Scoped check: \w+\./,
    );
  });

  it('gives a piece whose scoped check fails a fix turn in the same session', async () => {
    const { conversationId, runId } = await begin('#pieces #piecefix');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const p2 = (await children(runId)).filter((child) => child.pieceKey === 'P2');
    expect(p2.map((child) => child.resumeKey?.endsWith(':piece:P2'))).toEqual([true, true]);
    const list = await pieceList(runId);
    expect(list.pieces[1]).toMatchObject({ status: 'landed', check: 'passed', fixTurns: 1 });
    const checks = await artifactBodies<CheckBody>(t, 'check');
    expect(checks.filter((body) => body.name === 'Rivet').map((body) => body.status)).toEqual([
      'failed',
      'passed',
    ]);
    expect(await readFile(join(root, 'api.ts'), 'utf8')).toMatch(/fixed\n$/);
  });

  it('asks a piece that changed none of its files for the change before it lands', async () => {
    const { conversationId, runId } = await begin('#pieces #nochange');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const p1 = (await children(runId)).filter((child) => child.pieceKey === 'P1');
    expect(p1).toHaveLength(2);
    expect(p1[1]!.prompt).toContain('changed none of your files');
    const list = await pieceList(runId);
    expect(list.pieces[0]).toMatchObject({
      status: 'landed',
      check: 'passed',
      fixTurns: 1,
      filesChanged: ['store.ts'],
    });
  });

  it('never lands a piece that changes none of its files', async () => {
    const { conversationId, runId } = await begin('#pieces #nochangeever');
    const stopAtRetry: Answerer = (approval) =>
      approval.kind === 'retry'
        ? { optionId: CHECKPOINT_OPTION.stopReport }
        : answerEverything(approval);
    await driveToEnd(t, conversationId, runId, stopAtRetry, 90_000);
    const list = await pieceList(runId);
    expect(list.pieces[0]).toMatchObject({
      status: 'failed',
      note: 'The Builder changed none of its files.',
      filesChanged: [],
    });
    expect(list.pieces.slice(1).map((piece) => piece.status)).not.toContain('landed');
  });

  it('hands a piece to a fresh Builder once its context is 75% full', async () => {
    const { conversationId, runId } = await begin('#pieces #handoff');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const p1 = (await children(runId)).filter((child) => child.pieceKey === 'P1');
    expect(p1.map((child) => child.resumeKey?.replace(/^.*:piece:/, ''))).toEqual(['P1', 'P1:2']);
    expect(p1[1]!.prompt).toContain('## Handoff');
    expect(p1[1]!.prompt).toContain('- store.ts');
    expect((await pieceList(runId)).pieces[0]).toMatchObject({ status: 'landed', check: 'passed' });
  });

  it('runs the full checks once after integration and lets the integrator fix them', async () => {
    await writeFile(join(root, 'check.mjs'), FAILS_UNTIL_FIXED);
    await setCheckCommands(t, root, ['node check.mjs']);
    const { conversationId, runId } = await begin('#pieces #glue');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const crew = await children(runId);
    const integrators = crew.filter((child) => child.role === 'integrator');
    expect(integrators.map((child) => child.resumeKey?.endsWith(':integrator'))).toEqual([
      true,
      true,
    ]);
    expect(integrators[0]!.prompt).toContain('Wire the view into glue.ts');
    const full = (await artifactBodies<CheckBody>(t, 'check')).filter((body) =>
      body.results.some((result) => result.command === 'node check.mjs'),
    );
    expect(full.map((body) => [body.name, body.status])).toEqual([
      [integrators[0]!.name, 'failed'],
      [integrators[1]!.name, 'passed'],
    ]);
    expect(await readFile(join(root, 'glue.ts'), 'utf8')).toContain('glued');
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain(`Integration: ${integrators[0]!.name}`);
  });

  it('runs the integrator on the model the pieces shared and records why', async () => {
    await writeFile(join(root, 'check.mjs'), FAILS_UNTIL_FIXED);
    await setCheckCommands(t, root, ['node check.mjs']);
    const easy = Object.fromEntries(
      ['P1', 'P2', 'P3'].flatMap((key) => [
        [`${key}_reasoning`, 1],
        [`${key}_coding`, 1],
      ]),
    );
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario: NORMAL, scores: easy }), {
      coordinator: 'in_order',
    });
    const scenario = withTag(NORMAL, 'Split this up. #pieces #glue');
    const started = await startScenario(t, root, scenario, 'hands-off', 'pinned', 'opus[1m]');
    const { orchestration } = await driveToEnd(t, started.conversationId, started.runId);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ role: string; model: string; summary: string }>(
      `SELECT r.role, r.model, a.body->>'summary' AS summary
       FROM runs r JOIN run_advice a ON a.child_run_id = r.id AND a.purpose = 'route'
       WHERE r.parent_run_id = $1 AND r.role IN ('builder', 'integrator') ORDER BY r.created_at`,
      [started.runId],
    );
    expect(new Set(rows.filter((row) => row.role === 'builder').map((row) => row.model))).toEqual(
      new Set(['sonnet']),
    );
    const integrators = rows.filter((row) => row.role === 'integrator');
    expect(integrators.map((row) => row.model)).toEqual(['sonnet', 'sonnet']);
    expect(integrators[0]!.summary).toContain(
      'integrator follows the pieces · 3 of 3 pieces ran on this model; same model keeps the cache',
    );
  });

  it('asks a Critic that opened no files to re-check the riskiest ones in its session', async () => {
    harness = startOrchestrator(
      t,
      jevFetch({ calls: [], scenario: NORMAL, policy: { finding_1: 0.95 } }),
      { coordinator: 'in_order' },
    );
    const scenario = withTag(NORMAL, 'Split this up. #pieces #blindcritic');
    const { conversationId, runId } = await startScenario(t, root, scenario, 'hands-off');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{
      route: Record<string, string>;
      prompt: string;
      tools: number;
    }>(
      `SELECT route, prompt, tool_call_count AS tools FROM runs
       WHERE parent_run_id = $1 AND role = 'critic' ORDER BY created_at`,
      [runId],
    );
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.tools > 0)).toEqual([false, true, false, true]);
    expect(rows[0]!.route.resumeKey).toBe(rows[1]!.route.resumeKey);
    expect(rows[2]!.route.resumeKey).not.toBe(rows[1]!.route.resumeKey);
    expect(rows[1]!.prompt).toContain('You replied without opening any of the changed files.');
    expect(rows[1]!.prompt).toMatch(/Open `[^\n]*`store\.ts`[^\n]* now and re-check/);
    const reviews = await artifactBodies<{ verdict: string; findings: string[] }>(t, 'review');
    expect(reviews.map((review) => review.verdict)).toEqual(['concerns', 'looks_good']);
    expect(reviews[0]!.findings).toContain(BLIND_FINDING);
  });

  it('lands a docs-only piece without a scoped check and without a repair round', async () => {
    const { conversationId, runId } = await begin('#pieces #docspiece');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const crew = await children(runId);
    expect(crew.filter((child) => child.role === 'coordinator')).toHaveLength(1);
    expect(crew.find((child) => child.pieceKey === 'P3')!.prompt).toContain(
      'Scoped checks: none — docs only.',
    );
    const p3 = (await pieceList(runId)).pieces.find((piece) => piece.key === 'P3')!;
    expect(p3).toMatchObject({ status: 'landed', checks: [], check: 'none', owns: ['README.md'] });
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain('| none — docs only |');
  });

  it('asks about a heredoc file write like any other command, not as unreadable', async () => {
    const { conversationId, runId } = await begin('#pieces #heredoc');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ reason: string | null }>(
      `SELECT a.reason FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.parent_run_id = $1 AND a.kind = 'execute' AND a.title LIKE 'cat >>%'`,
      [runId],
    );
    expect(rows.map((row) => row.reason)).toEqual([null, null, null]);
  });

  it('asks the coordinator once to repair an invalid piece list', async () => {
    const { conversationId, runId } = await begin('#pieces #badpieces');
    await driveToEnd(t, conversationId, runId, undefined, 90_000);
    const coordinators = (await children(runId)).filter((child) => child.role === 'coordinator');
    expect(coordinators).toHaveLength(2);
    expect(coordinators[1]!.prompt).toContain('dependsOn has a cycle');
    expect((await pieceList(runId)).pieces).toHaveLength(3);
  });

  it('takes the piece list from a plan the coordinator proposed in plan mode', async () => {
    const { conversationId, runId } = await begin('#pieces #planfile');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const crew = await children(runId);
    expect(crew.filter((child) => child.role === 'coordinator')).toHaveLength(1);
    const list = await pieceList(runId);
    expect(list.pieces.map((piece) => [piece.key, piece.status])).toEqual([
      ['P1', 'landed'],
      ['P2', 'landed'],
      ['P3', 'landed'],
    ]);
    const { rows } = await t.db.query<{ status: string }>(
      `SELECT d.status FROM plan_documents d JOIN runs r ON r.id = d.source_run_id
       WHERE r.parent_run_id = $1 AND r.role = 'coordinator'`,
      [runId],
    );
    expect(rows.map((row) => row.status)).toEqual(['rejected']);
  });

  it('falls back to one Builder when the piece list stays invalid', async () => {
    const { conversationId, runId } = await begin('#pieces #alwaysbad');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const roles = (await children(runId)).map((child) => child.role);
    expect(roles.slice(0, 3)).toEqual(['coordinator', 'coordinator', 'builder']);
    expect(orchestration.pieces).toBeUndefined();
    const reply = (await assistantReplies(t, runId)).at(-1);
    expect(reply).toContain('Coordinator: built with one Builder instead (the piece list was');
  });

  it('builds every piece in the task copy at Full auto and merges it back once', async () => {
    const { conversationId, runId } = await begin('#pieces', 'full-auto');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM run_worktrees WHERE orchestration_run_id = $1',
      [runId],
    );
    expect(rows[0]!.count).toBe(1);
    for (const file of ['store.ts', 'api.ts', 'view.ts']) {
      expect(await readFile(join(root, file), 'utf8')).toContain('built by');
    }
    expect((await pieceList(runId)).pieces.map((piece) => piece.filesChanged)).toEqual([
      ['store.ts'],
      ['api.ts'],
      ['view.ts'],
    ]);
  });

  it('never engages when Spark is off', async () => {
    await updateProfile(t.db, t.workspaceId, { sparkEnabled: false });
    const { conversationId, runId } = await begin('#pieces');
    const { orchestration } = await driveToEnd(t, conversationId, runId, undefined, 90_000);
    expect(orchestration.status).toBe('succeeded');
    const roles = (await children(runId)).map((child) => child.role);
    expect(roles).not.toContain('coordinator');
    expect(orchestration.pieces).toBeUndefined();
    const { rows } = await t.db.query(
      `SELECT 1 FROM run_advice WHERE run_id = $1 AND purpose = 'parallel'`,
      [runId],
    );
    expect(rows).toEqual([]);
  });

  it('marks the running piece failed with an unknown outcome after a crash', async () => {
    const { runId } = await begin('#pieces #slowpiece', 'full-auto');
    await eventually(async () => {
      const taskId = (await loadOrchestration(t.db, runId))?.taskId;
      const list = taskId ? await currentPieceList(t.db, taskId) : null;
      return list?.pieces[1]?.status === 'running' ? list : null;
    }, 60_000);
    await t.db.query(`UPDATE jobs SET lease_expires_at = now() - interval '1 second'`);
    expect(await recoverExpiredLeases(t.db)).toBeGreaterThanOrEqual(1);
    const list = await pieceList(runId);
    expect(list.pieces.map((piece) => [piece.key, piece.status])).toEqual([
      ['P1', 'landed'],
      ['P2', 'failed'],
      ['P3', 'pending'],
    ]);
    expect(list.pieces[1]!.note).toBe(PIECE_OUTCOME_UNKNOWN);
  });
});
