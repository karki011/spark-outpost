import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { Approval } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import {
  TRIVIAL,
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
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const CLAUDE_MODES = JSON.stringify([
  ['default', 'Manual', null, 'standard'],
  ['acceptEdits', 'Accept edits', null, 'standard'],
  ['auto', 'Auto', null, 'auto_review'],
  ['bypassPermissions', 'Bypass permissions', null, 'full_access'],
]);
export const RULES = '# Rules\n';

export const floorCard = (approval: Approval) =>
  (approval.payload.instructionFiles ?? approval.payload.gitControl) !== undefined;

function answerFloorCards(kind: 'allow_once' | 'reject_once'): Answerer {
  return (approval) => {
    if (!floorCard(approval)) return answerEverything(approval);
    const option = approval.options.find((candidate) => candidate.kind === kind);
    return option ? { optionId: option.optionId } : null;
  };
}

export const denyFloorCards = answerFloorCards('reject_once');
export const allowFloorCards = answerFloorCards('allow_once');

export interface GateRecord {
  title: string;
  status: string;
  decidedBy: string | null;
}

export function floorRuns() {
  let t: TestDb;
  let root: string;
  let store: string;
  let harness: Harness | null = null;

  beforeEach(async () => {
    t = await createTestDb();
    root = await gitRepo();
    writeFileSync(join(root, 'AGENTS.md'), RULES);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    git('add', 'AGENTS.md');
    git('commit', '-qm', 'rules');
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

  async function run(mode: string, tags: string, answer: Answerer = denyFloorCards) {
    const scenario = { ...TRIVIAL, text: `${TRIVIAL.text} ${tags}` };
    harness = startOrchestrator(t, jevFetch({ calls: [], scenario }), {
      sessions: store,
      agentEnv: { FAKE_ACP_MODES: CLAUDE_MODES },
    });
    const sent = await startScenario(t, root, scenario, 'hands-off', 'auto', 'sonnet', mode);
    const { asked } = await driveToEnd(t, sent.conversationId, sent.runId, answer);
    await harness.stop();
    harness = null;
    const detail = await getConversationDetail(t.db, sent.conversationId);
    const status = await t.db.query<{ status: string }>('SELECT status FROM runs WHERE id = $1', [
      sent.runId,
    ]);
    const modes = await t.db.query<{ used_mode: string }>(
      `SELECT DISTINCT used_mode FROM runs
       WHERE conversation_id = $1 AND mode = 'do' AND used_mode IS NOT NULL`,
      [sent.conversationId],
    );
    const usedModes = modes.rows.map((row) => row.used_mode);
    return { ...sent, asked, detail: detail!, status: status.rows[0]!.status, usedModes };
  }

  async function userCards(conversationId: string): Promise<string[]> {
    const { rows } = await t.db.query<{ title: string }>(
      `SELECT a.title FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1
         AND (a.status = 'pending' OR a.decided_by NOT IN ('level', 'allowlist', 'run_rule'))
         AND a.kind IN ('edit', 'execute')`,
      [conversationId],
    );
    return rows.map((row) => row.title);
  }

  async function gateRecords(conversationId: string): Promise<GateRecord[]> {
    const { rows } = await t.db.query<{ title: string; status: string; decided_by: string | null }>(
      `SELECT a.title, a.status, a.decided_by FROM approvals a JOIN runs r ON r.id = a.run_id
       WHERE r.conversation_id = $1 AND a.kind = 'execute' ORDER BY a.title`,
      [conversationId],
    );
    return rows.map((row) => ({ title: row.title, status: row.status, decidedBy: row.decided_by }));
  }

  async function ranWithoutReview(conversationId: string): Promise<string[]> {
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

  async function railAudits(conversationId: string): Promise<string[]> {
    const { rows } = await t.db.query<{ rail: string }>(
      `SELECT l.payload #>> '{params,rail}' AS rail FROM run_protocol_log l
       JOIN runs r ON r.id = l.run_id
       WHERE r.conversation_id = $1 AND l.method = 'spark/rail_crossed'`,
      [conversationId],
    );
    return rows.map((row) => row.rail).sort();
  }

  return { root: () => root, run, userCards, gateRecords, ranWithoutReview, railAudits };
}
