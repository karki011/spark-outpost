import { pushActivitySchema, type PushNotice } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { AGENT_PUSH_METHOD } from './agent-push.ts';

const MAX_NOTICES = 50;

interface NoticeRow {
  run_id: string;
  seq: number;
  at: Date;
  payload: { params?: Record<string, unknown> } | null;
}

function toNotice(row: NoticeRow): PushNotice[] {
  const params = row.payload?.params ?? {};
  const parsed = pushActivitySchema.safeParse({ ...params, hook: params.stoppedBy ?? null });
  if (!parsed.success) return [];
  const shown = parsed.data.outcome === 'pushed' ? { ...parsed.data, output: '' } : parsed.data;
  return [
    { ...shown, id: `${row.run_id}:${row.seq}`, runId: row.run_id, at: row.at.toISOString() },
  ];
}

export async function conversationPushes(
  db: Queryable,
  workspaceId: string,
  conversationId: string,
): Promise<PushNotice[]> {
  const { rows } = await db.query<NoticeRow>(
    `SELECT l.run_id, l.seq, l.at, l.payload
     FROM run_protocol_log l
     JOIN runs r ON r.id = l.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.id = $1 AND c.workspace_id = $2 AND l.method = $3
     ORDER BY l.at DESC, l.seq DESC LIMIT $4`,
    [conversationId, workspaceId, AGENT_PUSH_METHOD, MAX_NOTICES],
  );
  return rows.flatMap(toNotice).reverse();
}
