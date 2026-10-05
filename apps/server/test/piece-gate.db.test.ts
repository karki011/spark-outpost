import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SHARED_INSTALL_REASON, type PieceGuard } from '../src/approvals/piece-guard.ts';
import { pieceUnclearReason } from '../src/approvals/piece-route.ts';
import { getApproval } from '../src/persistence/approvals.ts';
import { createApprovalGate, type GateDeps } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { commandRequest, doRun, recordingAppend } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

const PIECE: PieceGuard = {
  coordinated: true,
  sharesTree: true,
  owned: {
    key: 'P1',
    name: 'Bolt',
    paths: ['store.ts', 'store.test.ts'],
    globs: [],
    others: [
      { key: 'P2', name: 'Rivet', paths: ['api.ts'], globs: [] },
      { key: 'P3', name: 'Tack', paths: ['view.ts'], globs: [] },
    ],
  },
};
const CHECK = 'cd . && npx vitest run store.test.ts 2>&1 | tail -20';
const CLAUDE_NOTE = 'This command requires approval';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-piece-gate-')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  t = await createTestDb();
});

afterEach(async () => {
  await t.cleanup();
});

function soloGate(runId: string, deps: Partial<GateDeps> = {}) {
  return createApprovalGate({
    db: t.db,
    runId,
    provider: 'claude',
    mode: 'auto',
    builder: true,
    append: recordingAppend().append,
    waiters: new ApprovalWaiters(),
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
    ...deps,
  });
}

function gateFor(runId: string, deps: Partial<GateDeps> = {}) {
  return soloGate(runId, { piece: PIECE, ...deps });
}

const noted = (command: string, id = 'call-1') => ({
  ...commandRequest(root, command, id),
  agentReason: CLAUDE_NOTE,
});

async function recorded(runId: string) {
  const { rows } = await t.db.query<{
    status: string;
    decided_by: string | null;
    reason: string | null;
  }>('SELECT status, decided_by, reason FROM approvals WHERE run_id = $1 ORDER BY created_at', [
    runId,
  ]);
  return rows.map((row) => [row.status, row.decided_by, row.reason]);
}

async function pendingCard(runId: string) {
  const id = await eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0]?.id ?? null;
  });
  return getApproval(t.db, id);
}

describe('the gate for a piece that shares its folder with other pieces', () => {
  it('answers a targeted check itself in Auto, with or without Claude’s note', async () => {
    const run = await doRun(t, root);
    const gate = gateFor(run.runId);
    const signal = new AbortController().signal;
    const first = await gate.review(commandRequest(root, CHECK, 'a'), signal);
    const second = await gate.review(noted(CHECK, 'b'), signal);
    expect(first).toMatchObject({ outcome: 'selected', allowed: true });
    expect(second).toMatchObject({ outcome: 'selected', allowed: true });
    expect(second.note).toContain("Spark saw no change outside this piece's files");
    expect(await recorded(run.runId)).toEqual([
      ['allowed', 'level', null],
      ['allowed', 'level', null],
    ]);
  });

  it('shows the card in Manual, where the mode asks', async () => {
    const run = await doRun(t, root);
    const controller = new AbortController();
    const answer = gateFor(run.runId, { mode: 'default' }).review(noted(CHECK), controller.signal);
    const card = await pendingCard(run.runId);
    expect(card?.reason).toBeNull();
    expect(card?.payload.asksBecause).toBeUndefined();
    controller.abort();
    await answer;
  });

  it('refuses an install, a whole-project run and a write to another piece’s file without a card', async () => {
    const run = await doRun(t, root);
    const gate = gateFor(run.runId);
    const signal = new AbortController().signal;
    const commands = ['pnpm add left-pad', 'pnpm check', 'echo x > api.ts', 'npx eslint --fix .'];
    for (const [index, command] of commands.entries()) {
      const answer = await gate.review(noted(command, `c${index}`), signal);
      expect(answer).toMatchObject({ outcome: 'selected', allowed: false });
    }
    const rows = await recorded(run.runId);
    expect(rows.map(([status, by]) => [status, by])).toEqual(
      commands.map(() => ['denied', 'policy']),
    );
    expect(rows[0]![2]).toBe(SHARED_INSTALL_REASON);
    expect(rows[2]![2]).toMatch(/^Rivet \(P2\) owns `api.ts`/);
  });

  it('says why it asks when Claude noted a command Spark cannot read', async () => {
    const run = await doRun(t, root);
    const controller = new AbortController();
    const answer = gateFor(run.runId).review(
      noted('npx vitest run store.test.ts > "$OUT"'),
      controller.signal,
    );
    const card = await pendingCard(run.runId);
    expect(card?.reason).toBeNull();
    expect(card?.payload.asksBecause).toBe(pieceUnclearReason(PIECE.owned));
    expect(card?.payload.agentReason).toBe(CLAUDE_NOTE);
    controller.abort();
    await answer;
  });

  it('leaves an agent that sends only its own asks alone', async () => {
    const run = await doRun(t, root);
    const controller = new AbortController();
    const gate = gateFor(run.runId, { provider: 'codex', mode: 'agent' });
    const answer = gate.review(noted(CHECK), controller.signal);
    const card = await pendingCard(run.runId);
    expect(card?.payload.agentReason).toBe(CLAUDE_NOTE);
    expect(card?.payload.asksBecause).toBeUndefined();
    controller.abort();
    await answer;
  });
});

describe('the gate and temp folders', () => {
  const scratch =
    'git worktree add -q /tmp/cp-base HEAD && cd /tmp/cp-base && ls; cd "$OLDPWD"; git worktree remove /tmp/cp-base; rm -rf /tmp/cp-out';

  it('runs scratch work in a temp folder without a card in Auto and records it', async () => {
    const run = await doRun(t, root);
    const gate = soloGate(run.runId);
    const answer = await gate.review(commandRequest(root, scratch), new AbortController().signal);
    expect(answer).toMatchObject({ outcome: 'selected', allowed: true });
    expect(await recorded(run.runId)).toEqual([['allowed', 'level', null]]);
  });

  it('asks in Manual as the mode says, and names the path when a delete leaves the temp folder', async () => {
    const run = await doRun(t, root);
    const manual = new AbortController();
    const asked = soloGate(run.runId, { mode: 'default' }).review(
      commandRequest(root, scratch, 'm'),
      manual.signal,
    );
    expect((await pendingCard(run.runId))?.reason).toBeNull();
    manual.abort();
    await asked;
    const other = await doRun(t, root);
    const outside = new AbortController();
    const held = soloGate(other.runId).review(
      commandRequest(root, 'rm -rf /tmp/cp-out ~/Library/x', 'o'),
      outside.signal,
    );
    expect((await pendingCard(other.runId))?.reason).toBe(
      'This deletes ~/Library/x, which is outside this project',
    );
    outside.abort();
    await held;
  });
});
