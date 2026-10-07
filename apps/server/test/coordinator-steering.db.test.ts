import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InvolvementLevel, PieceList, SteerTarget } from '@spark-outpost/contracts';
import { applySteer } from '../src/coordinator/steer.ts';
import { classifySteer } from '../src/coordinator/steer-rules.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { PIECE_CHECK_SCRIPT } from './fake-acp-coordinator.ts';
import { children, pieceList, startPieces } from './coordinator-support.ts';
import { decideApproval } from '../src/persistence/approvals.ts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import {
  answerEverything,
  assistantReplies,
  connectProviders,
  driveToEnd,
  gitRepo,
  removeRepo,
  type Harness,
} from './orchestration-support.ts';
import { createTestApp, LOCAL_HEADERS, ORIGIN } from './app-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

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

async function p2Dirs(): Promise<string[]> {
  const copies = join(root, '.spark', 'worktrees');
  if (!existsSync(copies)) return [root];
  return (await readdir(copies)).map((dir) => join(copies, dir));
}

async function p2Wrote(): Promise<boolean> {
  return (await p2Dirs()).some((dir) => existsSync(join(dir, 'api.ts')));
}

async function answerPending(conversationId: string): Promise<void> {
  const detail = await getConversationDetail(t.db, conversationId);
  for (const approval of detail?.approvals ?? []) {
    if (approval.status !== 'pending') continue;
    const decision = answerEverything(approval);
    if (decision) {
      await decideApproval(t.db, t.workspaceId, approval.id, { scope: 'once', ...decision });
    }
  }
}

interface Started {
  conversationId: string;
  runId: string;
  taskId: string;
  list: PieceList;
}

async function untilP2Started(
  tags: string,
  options: { level?: InvolvementLevel; agentEnv?: Record<string, string> } = {},
): Promise<Started> {
  const started = await startPieces(t, root, tags, options);
  harness = started.harness;
  const { list, taskId } = await eventually(async () => {
    await answerPending(started.conversationId);
    const id = (await loadOrchestration(t.db, started.runId))?.taskId;
    const current = id ? await currentPieceList(t.db, id) : null;
    const p2 = (await children(t, started.runId)).find((child) => child.pieceKey === 'P2');
    const running = current?.pieces[1]?.status === 'running' && p2?.status === 'running';
    return running && id ? { list: current, taskId: id } : null;
  }, 60_000);
  await eventually(p2Wrote, 30_000);
  return { conversationId: started.conversationId, runId: started.runId, taskId, list };
}

async function steer(started: Started, text: string, target: SteerTarget = 'auto') {
  const classified = classifySteer(text, target, started.list.pieces);
  if (!classified.ok) throw new Error(classified.error);
  return applySteer(t.db, started.taskId, classified.plan);
}

const release = () => writeFile(join(root, '.git', 'release-P2'), 'go');

async function finish(started: Started) {
  return driveToEnd(t, started.conversationId, started.runId, undefined, 90_000);
}

async function notesOf(runId: string) {
  const { rows } = await t.db.query<{ kind: string; delivered_run_id: string | null }>(
    `SELECT n.kind, n.delivered_run_id FROM piece_notes n
     JOIN task_pieces p ON p.id = n.piece_id JOIN piece_lists l ON l.id = p.piece_list_id
     WHERE l.orchestration_run_id = $1 ORDER BY n.created_at`,
    [runId],
  );
  return rows;
}

describe('steering running pieces', { timeout: 120_000 }, () => {
  it('skips a running piece, reverts its changes and skips the pieces that depend on it', async () => {
    const started = await untilP2Started('#pieces #editslow');
    const reply = await steer(started, 'skip the API piece');
    expect(reply).toMatchObject({ kind: 'skip', pieces: ['P2', 'P3'] });
    const { orchestration } = await finish(started);
    expect(orchestration.status).toBe('succeeded');
    const list = await pieceList(t, started.runId);
    expect(list.pieces.map((piece) => [piece.key, piece.status, piece.note])).toEqual([
      ['P1', 'landed', null],
      ['P2', 'skipped', 'You skipped it.'],
      ['P3', 'skipped', 'skipped: depends on P2'],
    ]);
    expect(existsSync(join(root, 'api.ts'))).toBe(false);
    expect(existsSync(join(root, 'view.ts'))).toBe(false);
    expect(await readFile(join(root, 'store.ts'), 'utf8')).toBe('built by P1\n');
    const p3 = (await children(t, started.runId)).filter((child) => child.pieceKey === 'P3');
    expect(p3).toEqual([]);
    const final = (await assistantReplies(t, started.runId)).at(-1);
    expect(final).toContain(
      'Skipped: P2 · API (You skipped it.); P3 · View (skipped: depends on P2).',
    );
  });

  it('delivers an added requirement at the next turn boundary', async () => {
    const started = await untilP2Started('#pieces #holdpiece');
    const queued = await steer(started, 'Also for the API: return JSON');
    expect(queued).toMatchObject({ kind: 'requirement_added', pieces: ['P2'] });
    expect(queued.reply).toBe('Queued for Rivet: for the API: return JSON (next turn)');
    await release();
    const { orchestration } = await finish(started);
    expect(orchestration.status).toBe('succeeded');
    const p2 = (await children(t, started.runId)).filter((child) => child.pieceKey === 'P2');
    expect(p2).toHaveLength(2);
    expect(p2[0]!.prompt).not.toContain('return JSON');
    expect(p2[1]!.prompt).toContain('## Note from the coordinator');
    expect(p2[1]!.prompt).toContain('- Added requirement: for the API: return JSON');
    expect(p2[1]!.prompt).toMatch(/Acceptance:\n- api\.ts exists\n- for the API: return JSON/);
    expect(await notesOf(started.runId)).toEqual([
      { kind: 'requirement_added', delivered_run_id: p2[1]!.id },
    ]);
    const list = await pieceList(t, started.runId);
    expect(list.pieces[1]).toMatchObject({ status: 'landed', contractVersion: 2, notesQueued: 0 });
    expect(await readFile(join(root, 'api.ts'), 'utf8')).toMatch(/noted\n$/);
  });

  it('steers a running turn through the adapter when it supports steering', async () => {
    const started = await untilP2Started('#pieces #holdpiece', {
      agentEnv: { FAKE_ACP_STEERING: '1' },
    });
    await applySteer(
      t.db,
      started.taskId,
      { kind: 'steer', target: 'P2', body: 'Use UTC dates', provider: null },
      true,
    );
    const { orchestration } = await finish(started);
    expect(orchestration.status).toBe('succeeded');
    const runs = (await children(t, started.runId)).filter((child) => child.pieceKey === 'P2');
    expect(runs.map((run) => run.status)).toEqual(['succeeded']);
    expect(await notesOf(started.runId)).toEqual([
      { kind: 'steer', delivered_run_id: runs[0]!.id },
    ]);
    expect(await readFile(join(root, 'api.ts'), 'utf8')).toMatch(/started by P2\nsteered\n/);
  });

  it('stops and resumes a running turn with an urgent note when the adapter cannot steer', async () => {
    const started = await untilP2Started('#pieces #holdpiece');
    await applySteer(
      t.db,
      started.taskId,
      { kind: 'steer', target: 'P2', body: 'Use UTC dates', provider: null },
      true,
    );
    const { orchestration } = await finish(started);
    expect(orchestration.status).toBe('succeeded');
    const runs = (await children(t, started.runId)).filter((child) => child.pieceKey === 'P2');
    expect(runs.map((run) => run.status)).toEqual(['cancelled', 'succeeded']);
    expect(runs[1]!.prompt).toContain('## Your last turn was stopped so a note could reach you');
    expect(runs[1]!.prompt).toContain('- From the user: Use UTC dates');
    expect(await notesOf(started.runId)).toEqual([
      { kind: 'steer', delivered_run_id: runs[1]!.id },
    ]);
  });

  it('queues a note through the API while a piece runs and refuses once the pieces finish', async () => {
    const started = await untilP2Started('#pieces #holdpiece');
    const app = createTestApp(t);
    const notes = `/api/tasks/${started.taskId}/pieces/P2/notes`;
    const post = (path: string, body: object) =>
      request(app).post(path).set(LOCAL_HEADERS).set('Origin', ORIGIN).send(body);
    const queued = await post(notes, { kind: 'steer', body: 'Keep the old route' }).expect(202);
    expect(queued.body).toMatchObject({ kind: 'steer', pieces: ['P2'] });
    await post(notes, { kind: 'reassign', body: 'gemini' }).expect(400);
    await post(`/api/tasks/${started.taskId}/steer`, { text: 'skip it' }).expect(400);
    await release();
    await finish(started);
    const late = await post(notes, { kind: 'steer', body: 'One more thing' }).expect(409);
    expect(late.body.error).toBe('The pieces have finished; send a new message instead.');
  });
});
