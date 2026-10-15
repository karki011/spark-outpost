import { REMOTE_DEVICE_IDLE_DAYS } from '@spark-outpost/contracts';
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
