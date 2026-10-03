import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApproval } from '../src/persistence/approvals.ts';
import { createApprovalGate, type GateDeps } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { commandRequest, doRun, recordingAppend } from './approval-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-agent-mode-gate-')));
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

function gateFor(runId: string, deps: Partial<GateDeps>) {
  return createApprovalGate({
    db: t.db,
    runId,
    provider: 'claude',
    mode: 'auto',
    append: recordingAppend().append,
    waiters: new ApprovalWaiters(),
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
    ...deps,
  });
}

async function recorded(runId: string) {
  const { rows } = await t.db.query<{ status: string; decided_by: string | null }>(
    'SELECT status, decided_by FROM approvals WHERE run_id = $1 ORDER BY created_at',
    [runId],
  );
  return rows.map((row) => [row.status, row.decided_by]);
}

function pendingIn(runId: string) {
  return eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0]?.id ?? null;
  });
}

const READER_LOOP = `for r in $(git branch -r --format='%(refname:short)'); do git grep -l -i -E "AI_USER|aiUser" "$r" -- libs apps 2>/dev/null | sed "s|^|$r → |"; done | sort -u | head -20; ls -la "$(git rev-parse --git-common-dir)/FETCH_HEAD"`;
const BUILDER_STEPS = [
  `python3 - <<'EOF'\np='src/api.ts'\ns=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nEOF`,
  '(test -d node_modules || pnpm install --frozen-lockfile >/dev/null 2>&1); pnpm vitest run src',
  'pnpm install --frozen-lockfile 2>&1 | tail -2; pnpm tsc --noEmit; echo tsc-exit=$?',
];

describe('the approval gate follows the agent mode', () => {
  it("lets Claude's own asks for read-only commands through, loops and $(…) included", async () => {
    const run = await doRun(t, root);
    const reader = gateFor(run.runId, {
      posture: 'read_only',
      askRun: true,
      askAuto: async () => 'Automatic in an Ask turn',
    });
    const answer = await reader.review(
      commandRequest(root, READER_LOOP),
      new AbortController().signal,
    );
    expect(answer).toMatchObject({ outcome: 'selected', allowed: true });
    expect(await recorded(run.runId)).toEqual([['allowed', 'level']]);
  });

  it('no longer stops a Spark-gated Builder for code or installs it cannot see into', async () => {
    const run = await doRun(t, root);
    const builder = gateFor(run.runId, { provider: 'fake' });
    const signal = new AbortController().signal;
    const answers = await Promise.all(
      BUILDER_STEPS.map((step, index) =>
        builder.review(commandRequest(root, step, `b${index}`), signal),
      ),
    );
    expect(answers.every((answer) => answer.outcome === 'selected' && answer.allowed)).toBe(true);
    expect(await recorded(run.runId)).toEqual([
      ['allowed', 'level'],
      ['allowed', 'level'],
      ['allowed', 'level'],
    ]);
  });

  it('shows a request Claude makes in Manual mode instead of answering it', async () => {
    const run = await doRun(t, root);
    const gate = gateFor(run.runId, { mode: 'default' });
    const controller = new AbortController();
    const answer = gate.review(commandRequest(root, 'pnpm build'), controller.signal);
    const pending = await pendingIn(run.runId);
    expect((await getApproval(t.db, pending))?.reason).toBeNull();
    controller.abort();
    await answer;
  });

  it("shows Codex's own request with its reason instead of answering it", async () => {
    const run = await doRun(t, root);
    const gate = gateFor(run.runId, { provider: 'codex', mode: 'agent' });
    const request = {
      ...commandRequest(root, 'curl -sI https://example.com'),
      agentReason: 'The command needs network access outside the sandbox',
    };
    const controller = new AbortController();
    const answer = gate.review(request, controller.signal);
    const approval = await getApproval(t.db, await pendingIn(run.runId));
    expect(approval?.reason).toBeNull();
    expect(approval?.payload.agentReason).toBe(
      'The command needs network access outside the sandbox',
    );
    controller.abort();
    await answer;
  });
});
