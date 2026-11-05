import { REMOTE_DEVICE_IDLE_DAYS, type PushFailure } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

const DEVICE_SUBSCRIPTION_LIMIT = 5;

export interface NewPushSubscription {
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  hostname: string;
  serverKey: string;
}

export interface PushTarget {
  id: string;
  deviceId: string;
  deviceName: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  serverKey: string;
}

export async function savePushSubscription(
  db: Queryable,
  workspaceId: string,
  subscription: NewPushSubscription,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO remote_push_subscriptions
       (id, workspace_id, device_id, endpoint, p256dh, auth, hostname, server_key)
     SELECT $1, $2, d.id, $4, $5, $6, $7, $8 FROM remote_devices d
     WHERE d.workspace_id = $2 AND d.id = $3 AND d.revoked_at IS NULL
     ON CONFLICT (endpoint) DO UPDATE SET device_id = EXCLUDED.device_id,
       workspace_id = EXCLUDED.workspace_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       hostname = EXCLUDED.hostname, server_key = EXCLUDED.server_key, created_at = now()`,
    [
      newId(),
      workspaceId,
      subscription.deviceId,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      subscription.hostname,
      subscription.serverKey,
    ],
  );
  if (rowCount !== 1) return false;
  await db.query(
    `DELETE FROM remote_push_subscriptions WHERE device_id = $1 AND id NOT IN (
       SELECT id FROM remote_push_subscriptions WHERE device_id = $1
       ORDER BY created_at DESC, id DESC LIMIT ${DEVICE_SUBSCRIPTION_LIMIT}
     )`,
    [subscription.deviceId],
  );
  return true;
}

export async function deletePushSubscription(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
  endpoint: string,
): Promise<void> {
  await db.query(
    `DELETE FROM remote_push_subscriptions
     WHERE workspace_id = $1 AND device_id = $2 AND endpoint = $3`,
    [workspaceId, deviceId, endpoint],
  );
}

export async function forgetPushSubscription(db: Queryable, id: string): Promise<void> {
  await db.query('DELETE FROM remote_push_subscriptions WHERE id = $1', [id]);
}

export async function devicePushEndpoints(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
  serverKey: string,
): Promise<string[]> {
  const { rows } = await db.query<{ endpoint: string }>(
    `SELECT endpoint FROM remote_push_subscriptions
     WHERE workspace_id = $1 AND device_id = $2 AND server_key = $3
     ORDER BY created_at`,
    [workspaceId, deviceId, serverKey],
  );
  return rows.map((row) => row.endpoint);
}

export async function pushTargets(
  db: Queryable,
  workspaceId: string,
  hostname: string,
): Promise<PushTarget[]> {
  const { rows } = await db.query<PushTarget>(
    `SELECT s.id, s.device_id AS "deviceId", d.name AS "deviceName", s.endpoint, s.p256dh, s.auth,
       s.server_key AS "serverKey"
     FROM remote_push_subscriptions s JOIN remote_devices d ON d.id = s.device_id
     WHERE s.workspace_id = $1 AND s.hostname = $2 AND d.revoked_at IS NULL
       AND d.last_seen_at >= now() - interval '${REMOTE_DEVICE_IDLE_DAYS} days'
     ORDER BY s.created_at, s.id`,
    [workspaceId, hostname],
  );
  return rows;
}

export async function pushContact(db: Queryable, workspaceId: string): Promise<string | null> {
  const { rows } = await db.query<{ push_contact: string | null }>(
    'SELECT push_contact FROM remote_access_settings WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.push_contact ?? null;
}

export async function savePushContact(
  db: Queryable,
  workspaceId: string,
  contact: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO remote_access_settings (workspace_id, push_contact, push_contact_changed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (workspace_id) DO UPDATE SET push_contact = $2,
       push_contact_changed_at = now(), updated_at = now()`,
    [workspaceId, contact],
  );
}

interface FailureRow {
  created_at: Date;
  device_name: string | null;
  status: number | null;
  detail: { outcome?: unknown; reason?: unknown };
}

export async function lastPushFailures(db: Queryable, workspaceId: string): Promise<PushFailure[]> {
  const { rows } = await db.query<FailureRow>(
    `SELECT * FROM (
       SELECT DISTINCT ON (a.device_id) a.created_at, a.device_name, a.status, a.detail
       FROM remote_audit a JOIN remote_devices d ON d.id = a.device_id
       WHERE a.workspace_id = $1 AND a.action = 'notification_sent' AND d.revoked_at IS NULL
         AND a.created_at > COALESCE((SELECT push_contact_changed_at FROM remote_access_settings
           WHERE workspace_id = $1), '-infinity')
       ORDER BY a.device_id, a.created_at DESC, a.id DESC
     ) latest WHERE detail->>'outcome' = 'failed' ORDER BY created_at DESC`,
    [workspaceId],
  );
  return rows.map((row) => ({
    at: row.created_at.toISOString(),
    deviceName: row.device_name,
    status: row.status,
    reason: typeof row.detail.reason === 'string' ? row.detail.reason : null,
  }));
}
