import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import type { Approval, WorkPlace } from '@spark-outpost/contracts';
import { getConversationDetail } from '../src/persistence/conversations.ts';
import { createTestDb, type TestDb } from './support.ts';
import {
  allowOnce,
  driveToEnd,
  gitRepo,
  openChat,
  removeRepo,
  sendMessage,
  type Answerer,
} from './turn-support.ts';
import { connectAgents, startTurnWorker } from './turn-worker.ts';
import type { Worker } from '../src/workflow/worker.ts';

const REQUEST = 'Fix the typo in the README heading. #build';

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
    if (!floorCard(approval)) return allowOnce(approval);
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

export function floorRuns(place: { workPlace?: WorkPlace } = {}) {
  let t: TestDb;
  let root: string;
  let store: string;
  let worker: Worker | null = null;

  beforeEach(async () => {
    t = await createTestDb(place);
    root = await gitRepo();
    writeFileSync(join(root, 'AGENTS.md'), RULES);
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
    git('add', 'AGENTS.md');
    git('commit', '-qm', 'rules');
    store = mkdtempSync(join(tmpdir(), 'fake-acp-store-'));
    await connectAgents(t);
  });

  afterEach(async () => {
    await worker?.stop();
    worker = null;
    await t.cleanup();
    await removeRepo(root);
    rmSync(store, { recursive: true, force: true });
  });

  async function run(mode: string, tags: string, answer: Answerer = denyFloorCards) {
    worker = startTurnWorker(t, {
      sessions: store,
      agentEnv: { FAKE_ACP_MODES: CLAUDE_MODES },
    });
    const conversationId = await openChat(t, { root, level: 'hands-off' });
    const runId = await sendMessage(t, conversationId, `${REQUEST} ${tags}`, {
      permission: 'do',
      agentMode: mode,
    });
    const sent = { conversationId, runId };
    const { asked } = await driveToEnd(t, conversationId, runId, answer);
    await worker.stop();
    worker = null;
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
