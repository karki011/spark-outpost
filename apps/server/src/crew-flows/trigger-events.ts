import { branchMatches } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { branchTip, chatCode } from './chat-code.ts';
import { markSeen, queueTrigger, triggersWith } from './trigger-records.ts';

export interface EndedTurn {
  workspaceId: string;
  conversationId: string;
  runId: string;
}

async function triggerable(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT (r.parent_run_id IS NULL AND r.source IS DISTINCT FROM 'workflow'
             AND c.kind = 'chat' AND c.session_type = 'chat'
             AND NOT EXISTS (
               SELECT 1 FROM profiles pf
               WHERE pf.workspace_id = c.workspace_id AND pf.assistant_conversation_id = c.id)
             AND EXISTS (
               SELECT 1 FROM conversation_projects cp WHERE cp.conversation_id = c.id)) AS ok
     FROM runs r JOIN conversations c ON c.id = r.conversation_id WHERE r.id = $1`,
    [runId],
  );
  return rows[0]?.ok === true;
}

async function queueAll(
  db: Queryable,
  turn: EndedTurn,
  kind: 'turn_changed' | 'commit',
  branch: string | null,
  now: Date,
): Promise<void> {
  const flag = kind === 'turn_changed' ? 'turn_changed' : 'on_commit';
  for (const { workflowId, triggers } of await triggersWith(
    db,
    turn.workspaceId,
    flag,
    turn.conversationId,
  )) {
    if (kind === 'commit' && !branchMatches(triggers.branchGlob, branch)) continue;
    await queueTrigger(
      db,
      turn.workspaceId,
      {
        workflowId,
        conversationId: turn.conversationId,
        kind,
        debounceMinutes: triggers.debounceMinutes,
      },
      now,
    );
  }
}

async function newCommit(
  db: Queryable,
  conversationId: string,
): Promise<{ branch: string | null } | null> {
  const code = await chatCode(db, conversationId);
  if (!code) return null;
  const tip = await branchTip(code.root);
  if (!tip) return null;
  const { rows } = await db.query<{ tip: string }>(
    'SELECT tip FROM chat_branch_tips WHERE conversation_id = $1',
    [conversationId],
  );
  await db.query(
    `INSERT INTO chat_branch_tips (conversation_id, branch, tip) VALUES ($1, $2, $3)
     ON CONFLICT (conversation_id) DO UPDATE
     SET branch = EXCLUDED.branch, tip = EXCLUDED.tip, updated_at = now()`,
    [conversationId, tip.branch, tip.tip],
  );
  const before = rows[0]?.tip ?? code.base;
  return before && before !== tip.tip ? { branch: tip.branch } : null;
}

export async function noteEndedTurn(
  db: Queryable,
  turn: EndedTurn,
  changed: boolean,
  now = new Date(),
): Promise<void> {
  if (!(await triggerable(db, turn.runId))) return;
  if (changed) await queueAll(db, turn, 'turn_changed', null, now);
  const committed = await newCommit(db, turn.conversationId);
  if (committed) await queueAll(db, turn, 'commit', committed.branch, now);
}

interface WatchRow {
  id: string;
  conversation_id: string;
  head_sha: string;
}

async function sparkPulls(
  db: Queryable,
  workspaceId: string,
  projectId: string | null,
): Promise<WatchRow[]> {
  const { rows } = await db.query<WatchRow>(
    `SELECT w.id, w.conversation_id, w.head_sha FROM pr_watches w
     JOIN conversations c ON c.id = w.conversation_id
     WHERE w.workspace_id = $1 AND w.opened_via IN ('ship', 'agent') AND w.pr_state = 'open'
       AND w.head_sha IS NOT NULL AND c.kind = 'chat' AND c.archived_at IS NULL
       AND ($2::uuid IS NULL OR $2 = (
         SELECT cp.project_id FROM conversation_projects cp WHERE cp.conversation_id = c.id
         ORDER BY cp.position, cp.created_at LIMIT 1))`,
    [workspaceId, projectId],
  );
  return rows;
}

const pullMark = (watch: WatchRow) => `pr:${watch.id}:${watch.head_sha}`;

export async function seedPullMarks(
  db: Queryable,
  workspaceId: string,
  workflowId: string,
  projectId: string | null,
): Promise<void> {
  for (const watch of await sparkPulls(db, workspaceId, projectId)) {
    await markSeen(db, workspaceId, workflowId, pullMark(watch));
  }
}

export async function scanPullRequests(
  db: Queryable,
  workspaceId: string,
  now: Date,
): Promise<void> {
  for (const { workflowId, triggers } of await triggersWith(db, workspaceId, 'pull_request')) {
    for (const watch of await sparkPulls(db, workspaceId, triggers.projectId)) {
      if (!(await markSeen(db, workspaceId, workflowId, pullMark(watch)))) continue;
      await queueTrigger(
        db,
        workspaceId,
        {
          workflowId,
          conversationId: watch.conversation_id,
          kind: 'pull_request',
          debounceMinutes: triggers.debounceMinutes,
        },
        now,
      );
    }
  }
}
