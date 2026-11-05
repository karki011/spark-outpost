import {
  PREVIEW_LOG_TAIL_MAX,
  type PreviewAsker,
  type PreviewServer,
  type PreviewStatus,
} from '@spark-outpost/contracts';
import { withTransaction, type Db, type Queryable } from './db.ts';
import { newId } from './ids.ts';

export interface PreviewRow {
  id: string;
  workspaceId: string;
  projectId: string;
  folder: string;
  wanted: 'running' | 'stopped';
  status: PreviewStatus;
  url: string | null;
  pid: number | null;
  restarts: number;
  detail: string | null;
  logTail: string;
  askedBy: PreviewAsker;
  runId: string | null;
  conversationId: string | null;
  updatedAt: Date;
}

interface Row {
  id: string;
  workspace_id: string;
  project_id: string;
  folder: string;
  wanted: 'running' | 'stopped';
  status: PreviewStatus;
  url: string | null;
  pid: number | null;
  restarts: number;
  detail: string | null;
  log_tail: string;
  asked_by: PreviewAsker;
  asked_run_id: string | null;
  asked_conversation_id: string | null;
  updated_at: Date;
}

function toRow(row: Row): PreviewRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    folder: row.folder,
    wanted: row.wanted,
    status: row.status,
    url: row.url,
    pid: row.pid,
    restarts: row.restarts,
    detail: row.detail,
    logTail: row.log_tail,
    askedBy: row.asked_by,
    runId: row.asked_run_id,
    conversationId: row.asked_conversation_id,
    updatedAt: row.updated_at,
  };
}

export function toPreviewServer(row: PreviewRow): PreviewServer {
  return {
    id: row.id,
    status: row.status,
    url: row.url,
    folder: row.folder,
    detail: row.detail,
    restarts: row.restarts,
    askedBy: row.askedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PreviewAsk {
  by: PreviewAsker;
  runId: string | null;
  conversationId: string | null;
}

export type PreviewAction = 'start' | 'ready' | 'failed' | 'crashed' | 'restart' | 'stop';

export interface PreviewEvent {
  workspaceId: string;
  projectId: string;
  folder: string;
  action: PreviewAction;
  ask: PreviewAsk;
  detail?: Record<string, unknown>;
}

export async function recordPreviewEvent(db: Queryable, event: PreviewEvent): Promise<void> {
  await db.query(
    `INSERT INTO preview_events
       (id, workspace_id, project_id, conversation_id, run_id, folder, action, asked_by, detail)
     SELECT $1, $2, (SELECT id FROM projects WHERE id = $3),
       (SELECT id FROM conversations WHERE id = $4), (SELECT id FROM runs WHERE id = $5),
       $6, $7, $8, $9::jsonb`,
    [
      newId(),
      event.workspaceId,
      event.projectId,
      event.ask.conversationId,
      event.ask.runId,
      event.folder,
      event.action,
      event.ask.by,
      JSON.stringify(event.detail ?? {}),
    ],
  );
}

export async function previewRow(db: Queryable, id: string): Promise<PreviewRow | null> {
  const { rows } = await db.query<Row>('SELECT * FROM preview_servers WHERE id = $1', [id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function previewRowAt(
  db: Queryable,
  projectId: string,
  folder: string,
): Promise<PreviewRow | null> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM preview_servers WHERE project_id = $1 AND folder = $2',
    [projectId, folder],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

export async function previewRows(db: Queryable, workspaceId: string): Promise<PreviewRow[]> {
  const { rows } = await db.query<Row>(
    'SELECT * FROM preview_servers WHERE workspace_id = $1 ORDER BY updated_at',
    [workspaceId],
  );
  return rows.map(toRow);
}

export function previewRowLive(row: PreviewRow): boolean {
  return row.wanted === 'running' && (row.status === 'starting' || row.status === 'ready');
}

export async function projectPreviewRows(db: Queryable, projectId: string): Promise<PreviewRow[]> {
  const { rows } = await db.query<Row>('SELECT * FROM preview_servers WHERE project_id = $1', [
    projectId,
  ]);
  return rows.map(toRow);
}

export interface PreviewTarget {
  workspaceId: string;
  projectId: string;
  folder: string;
}

export async function askPreviewStart(
  db: Db,
  target: PreviewTarget,
  ask: PreviewAsk,
): Promise<PreviewRow> {
  return withTransaction(db, async (client) => {
    await client.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [target.projectId]);
    const existing = await previewRowAt(client, target.projectId, target.folder);
    if (existing && previewRowLive(existing)) return existing;
    const { rows } = await client.query<Row>(
      `INSERT INTO preview_servers
         (id, workspace_id, project_id, folder, wanted, status, asked_by, asked_run_id,
          asked_conversation_id)
       VALUES ($1, $2, $3, $4, 'running', 'starting', $5,
         (SELECT id FROM runs WHERE id = $6), (SELECT id FROM conversations WHERE id = $7))
       ON CONFLICT (project_id, folder) DO UPDATE SET
         wanted = 'running', status = 'starting', url = NULL, pid = NULL, restarts = 0,
         detail = NULL, log_tail = '', asked_by = EXCLUDED.asked_by,
         asked_run_id = EXCLUDED.asked_run_id,
         asked_conversation_id = EXCLUDED.asked_conversation_id, updated_at = now()
       RETURNING *`,
      [
        newId(),
        target.workspaceId,
        target.projectId,
        target.folder,
        ask.by,
        ask.runId,
        ask.conversationId,
      ],
    );
    await recordPreviewEvent(client, { ...target, action: 'start', ask });
    return toRow(rows[0]!);
  });
}

export async function askPreviewStop(
  db: Db,
  id: string,
  ask: PreviewAsk,
  reason: string,
): Promise<PreviewRow | null> {
  return withTransaction(db, async (client) => {
    const { rows } = await client.query<Row>(
      'SELECT * FROM preview_servers WHERE id = $1 FOR UPDATE',
      [id],
    );
    const existing = rows[0] ? toRow(rows[0]) : null;
    if (!existing || existing.wanted === 'stopped') return existing;
    const updated = await client.query<Row>(
      `UPDATE preview_servers SET wanted = 'stopped', updated_at = now() WHERE id = $1
       RETURNING *`,
      [id],
    );
    await recordPreviewEvent(client, {
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
      folder: existing.folder,
      action: 'stop',
      ask,
      detail: { reason },
    });
    return toRow(updated.rows[0]!);
  });
}

export interface PreviewState {
  status: PreviewStatus;
  url?: string | null;
  pid?: number | null;
  restarts?: number;
  detail?: string | null;
  wanted?: 'running' | 'stopped';
}

export async function savePreviewState(
  db: Queryable,
  id: string,
  state: PreviewState,
  logTail: string,
): Promise<void> {
  await db.query(
    `UPDATE preview_servers SET
       status = $2, url = $3, pid = $4, restarts = COALESCE($5, restarts), detail = $6,
       wanted = COALESCE($7, wanted), log_tail = $8, updated_at = now()
     WHERE id = $1`,
    [
      id,
      state.status,
      state.url ?? null,
      state.pid ?? null,
      state.restarts ?? null,
      state.detail?.slice(0, 2000) ?? null,
      state.wanted ?? null,
      logTail.slice(-PREVIEW_LOG_TAIL_MAX),
    ],
  );
}

export async function savePreviewLog(db: Queryable, id: string, logTail: string): Promise<void> {
  await db.query('UPDATE preview_servers SET log_tail = $2 WHERE id = $1', [
    id,
    logTail.slice(-PREVIEW_LOG_TAIL_MAX),
  ]);
}

export async function stopAllPreviewRows(db: Queryable, workspaceId: string): Promise<void> {
  await db.query(
    `UPDATE preview_servers SET wanted = 'stopped', status = 'stopped', pid = NULL,
       updated_at = now()
     WHERE workspace_id = $1 AND (wanted <> 'stopped' OR status <> 'stopped')`,
    [workspaceId],
  );
}

export async function nudgePreviews(db: Queryable): Promise<void> {
  await db.query(`SELECT notify_change('preview', NULL, NULL)`);
}
