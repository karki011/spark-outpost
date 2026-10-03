import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { decideRailFlag } from '../src/projects/rail-flag-decision.ts';
import { OUTSIDE_FILE } from './fake-acp-rails.ts';
import {
  TRIVIAL,
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;
let store: string;
let harness: Harness | null = null;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
  await connectProviders(t);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await t.cleanup();
  await removeRepo(root);
  rmSync(store, { recursive: true, force: true });
});

async function bypassRun(tags: string) {
  const scenario = { ...TRIVIAL, text: `${TRIVIAL.text} ${tags}` };
  harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), { sessions: store });
  const sent = await startScenario(
    t,
    root,
    scenario,
    'hands-off',
    'auto',
    'sonnet',
    'bypassPermissions',
  );
  await driveToEnd(t, sent.conversationId, sent.runId);
  await harness.stop();
  harness = null;
  return sent;
}

async function unreviewedTitles(conversationId: string): Promise<string[]> {
  const { rows } = await t.db.query<{ title: string | null }>(
    `SELECT (SELECT s.payload #>> '{params,update,title}' FROM run_protocol_log s
             WHERE s.run_id = l.run_id
               AND s.payload #>> '{params,update,toolCallId}' = l.payload #>> '{params,update,toolCallId}'
               AND s.payload #>> '{params,update,title}' IS NOT NULL
             ORDER BY s.seq LIMIT 1) AS title
     FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
     WHERE r.conversation_id = $1 AND l.unreviewed`,
    [conversationId],
  );
  return rows.map((row) => row.title ?? '');
}

describe('Spark moderates Bypass permissions', { timeout: 120_000 }, () => {
  it('flags a write outside the project without stopping the run, and records it in the audit', async () => {
    const { conversationId, runId } = await bypassRun('#outsidewrite');
    const detail = await getConversationDetail(t.db, conversationId);
    const flags = detail!.railFlags ?? [];
    expect(flags).toEqual([
      expect.objectContaining({
        rail: 'outside_write',
        title: expect.stringMatching(new RegExp(`wrote outside the project: ${OUTSIDE_FILE}$`)),
        inside: false,
        originals: [{ path: OUTSIDE_FILE, text: 'old notes' }],
        status: 'open',
        turnRunId: runId,
      }),
    ]);
    expect(detail!.conversation.needsInput).toBe(true);
    expect(detail!.conversation.attention).toMatchObject({ kind: 'flag', title: flags[0]!.title });
    expect(await unreviewedTitles(conversationId)).toContain(`Write ${OUTSIDE_FILE}`);
    const { rows } = await t.db.query(
      `SELECT 1 FROM run_protocol_log WHERE method = 'spark/rail_crossed' AND direction = 'harness'`,
    );
    expect(rows).toHaveLength(1);

    await expect(
      decideRailFlag(t.db, t.workspaceId, flags[0]!.id, { action: 'revert' }),
    ).rejects.toThrow(/outside the project/);
    const dismissed = await decideRailFlag(t.db, t.workspaceId, flags[0]!.id, {
      action: 'dismiss',
    });
    expect(dismissed.status).toBe('dismissed');
    const after = await getConversationDetail(t.db, conversationId);
    expect(after!.conversation.attention?.kind).not.toBe('flag');
  });

  it('notices an instruction file changed without a tool call, and reverts the run', async () => {
    const { conversationId } = await bypassRun('#agentsedit');
    const detail = await getConversationDetail(t.db, conversationId);
    const flag = (detail!.railFlags ?? []).find((candidate) => candidate.rail === 'instructions');
    expect(flag).toMatchObject({ paths: ['AGENTS.md'], inside: true, status: 'open' });
    const reverted = await decideRailFlag(t.db, t.workspaceId, flag!.id, { action: 'revert' });
    expect(reverted.status).toBe('reverted');
  });
});
