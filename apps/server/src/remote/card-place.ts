import { remoteCardPlace, type RemoteAccess, type RemoteCardPlace } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { devicePasskeys } from './passkey-store.ts';
import { approvalPayload, remoteAccess } from './store.ts';

export async function devicePlaceOf(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
  payload: unknown,
  access?: RemoteAccess,
): Promise<RemoteCardPlace> {
  const settings = access ?? (await remoteAccess(db, workspaceId));
  const passkey = (await devicePasskeys(db, workspaceId, deviceId)).length > 0;
  return remoteCardPlace(payload, {
    switches: settings.switches,
    answering: settings.cardAnswering,
    passkey,
  });
}

export async function earliestMacOnlyCard(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
  conversationId: string,
): Promise<Date | null> {
  const { rows } = await db.query<{ payload: unknown; created_at: Date }>(
    `SELECT a.payload, a.created_at FROM approvals a JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE c.id = $1 AND c.workspace_id = $2 AND a.status = 'pending'
     ORDER BY a.created_at`,
    [conversationId, workspaceId],
  );
  if (rows.length === 0) return null;
  const access = await remoteAccess(db, workspaceId);
  for (const row of rows) {
    const place = await devicePlaceOf(db, workspaceId, deviceId, row.payload, access);
    if (place.place === 'mac') return row.created_at;
  }
  return null;
}

const APPROVAL_KEY = /^approval:([0-9a-f-]{36})$/;

export async function macOnlyAttentionKey(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
  key: string,
): Promise<boolean> {
  const approvalId = APPROVAL_KEY.exec(key)?.[1];
  if (!approvalId) return false;
  const payload = await approvalPayload(db, workspaceId, approvalId);
  if (payload === null) return false;
  return (await devicePlaceOf(db, workspaceId, deviceId, payload)).place === 'mac';
}
