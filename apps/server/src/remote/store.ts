import {
  REMOTE_DEVICE_IDLE_DAYS,
  REMOTE_SWITCH_DEFAULTS,
  type RemoteAccess,
  type RemoteAuditAction,
  type RemoteAuditEntry,
  type RemoteSwitch,
  type RemoteSwitches,
} from '@spark-outpost/contracts';
import type { Db, Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

const SWITCH_COLUMNS: Record<RemoteSwitch, string> = {
  settings: 'can_settings',
  connections: 'can_connections',
  projects: 'can_projects',
  agentMode: 'can_agent_mode',
  highRiskCards: 'can_high_risk_cards',
  signIns: 'can_sign_ins',
  reset: 'can_reset',
  devices: 'can_devices',
  passkeys: 'can_passkeys',
  terminal: 'can_terminal',
  terminalApprove: 'can_terminal_approve',
  notifications: 'can_notifications',
};

const SWITCH_IDS = Object.keys(SWITCH_COLUMNS) as RemoteSwitch[];

type SettingsRow = { hostname: string | null } & Record<string, boolean | string | null>;

function toAccess(row: SettingsRow | undefined): RemoteAccess {
  if (!row) return { hostname: null, switches: { ...REMOTE_SWITCH_DEFAULTS } };
  const switches = Object.fromEntries(
    SWITCH_IDS.map((id) => [id, row[SWITCH_COLUMNS[id]] === true]),
  ) as RemoteSwitches;
  return { hostname: row.hostname, switches };
}

export async function remoteAccess(db: Queryable, workspaceId: string): Promise<RemoteAccess> {
  const { rows } = await db.query<SettingsRow>(
    'SELECT * FROM remote_access_settings WHERE workspace_id = $1',
    [workspaceId],
  );
  return toAccess(rows[0]);
}

export async function saveRemoteHostname(
  db: Queryable,
  workspaceId: string,
  hostname: string | null,
): Promise<RemoteAccess> {
  const { rows } = await db.query<SettingsRow>(
    `INSERT INTO remote_access_settings (workspace_id, hostname) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET hostname = $2, updated_at = now()
     RETURNING *`,
    [workspaceId, hostname],
  );
  return toAccess(rows[0]);
}

export async function saveRemoteSwitches(
  db: Queryable,
  workspaceId: string,
  change: { [id in RemoteSwitch]?: boolean | undefined },
): Promise<RemoteAccess> {
  const changed = SWITCH_IDS.filter((id) => change[id] !== undefined);
  const columns = changed.map((id) => SWITCH_COLUMNS[id]);
  const values = changed.map((id) => change[id]);
  const placeholders = values.map((_value, index) => `$${index + 2}`);
  const updates = columns.map((column) => `${column} = EXCLUDED.${column}`);
  const { rows } = await db.query<SettingsRow>(
    `INSERT INTO remote_access_settings (${['workspace_id', ...columns].join(', ')})
     VALUES (${['$1', ...placeholders].join(', ')})
     ON CONFLICT (workspace_id) DO UPDATE SET ${[...updates, 'updated_at = now()'].join(', ')}
     RETURNING *`,
    [workspaceId, ...values],
  );
  return toAccess(rows[0]);
}

export interface DeviceRow {
  id: string;
  name: string;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  expired: boolean;
}

const DEVICE_COLUMNS = `id, name, created_at, last_seen_at, revoked_at, replaced_by,
  last_seen_at < now() - interval '${REMOTE_DEVICE_IDLE_DAYS} days' AS expired`;

export async function listDevices(db: Queryable, workspaceId: string): Promise<DeviceRow[]> {
  const { rows } = await db.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM remote_devices WHERE workspace_id = $1 ORDER BY created_at`,
    [workspaceId],
  );
  return rows;
}

export async function deviceByTokenHash(
  db: Queryable,
  workspaceId: string,
  tokenHash: string,
): Promise<DeviceRow | null> {
  const { rows } = await db.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM remote_devices
     WHERE workspace_id = $1 AND (
       token_hash = $2
       OR id = (SELECT device_id FROM remote_device_sessions WHERE token_hash = $2)
     )`,
    [workspaceId, tokenHash],
  );
  return rows[0] ?? null;
}

export async function addDevice(
  db: Queryable,
  workspaceId: string,
  device: { name: string; tokenHash: string },
): Promise<DeviceRow> {
  const { rows } = await db.query<DeviceRow>(
    `INSERT INTO remote_devices (id, workspace_id, name, token_hash) VALUES ($1, $2, $3, $4)
     RETURNING ${DEVICE_COLUMNS}`,
    [newId(), workspaceId, device.name, device.tokenHash],
  );
  return rows[0]!;
}

export async function repairDevice(
  db: Queryable,
  workspaceId: string,
  id: string,
  device: { name: string; tokenHash: string; carriedHash: string },
): Promise<DeviceRow | null> {
  const { rows } = await db.query<DeviceRow>(
    `WITH usable AS (
       SELECT id FROM remote_devices
       WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
         AND last_seen_at >= now() - interval '${REMOTE_DEVICE_IDLE_DAYS} days'
     ), session AS (
       UPDATE remote_device_sessions SET token_hash = $4
       WHERE token_hash = $5 AND device_id IN (SELECT id FROM usable)
     )
     UPDATE remote_devices SET name = $3, last_seen_at = now(),
       token_hash = CASE WHEN token_hash = $5 THEN $4 ELSE token_hash END
     WHERE id IN (SELECT id FROM usable)
     RETURNING ${DEVICE_COLUMNS}`,
    [workspaceId, id, device.name, device.tokenHash, device.carriedHash],
  );
  return rows[0] ?? null;
}

const PASSKEYS_GONE = `gone AS (
  DELETE FROM remote_passkeys WHERE workspace_id = $1 AND device_id = $2
), push_gone AS (
  DELETE FROM remote_push_subscriptions WHERE workspace_id = $1 AND device_id = $2
)`;

export async function markDeviceReplaced(
  db: Queryable,
  workspaceId: string,
  id: string,
  replacedBy: string,
): Promise<void> {
  await db.query(
    `WITH ${PASSKEYS_GONE}
     UPDATE remote_devices SET replaced_by = $3, revoked_at = COALESCE(revoked_at, now())
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, replacedBy],
  );
}

const SEEN_EVERY_SECONDS = 60;

export async function touchDevice(db: Queryable, id: string): Promise<void> {
  await db.query(
    `UPDATE remote_devices SET last_seen_at = now()
     WHERE id = $1 AND last_seen_at < now() - interval '${SEEN_EVERY_SECONDS} seconds'`,
    [id],
  );
}

export async function renameDevice(
  db: Queryable,
  workspaceId: string,
  id: string,
  name: string,
): Promise<DeviceRow | null> {
  const { rows } = await db.query<DeviceRow>(
    `UPDATE remote_devices SET name = $3 WHERE workspace_id = $1 AND id = $2
     RETURNING ${DEVICE_COLUMNS}`,
    [workspaceId, id, name],
  );
  return rows[0] ?? null;
}

export async function revokeDevice(
  db: Queryable,
  workspaceId: string,
  id: string,
): Promise<DeviceRow | null> {
  const { rows } = await db.query<DeviceRow>(
    `WITH ${PASSKEYS_GONE}
     UPDATE remote_devices SET revoked_at = COALESCE(revoked_at, now())
     WHERE workspace_id = $1 AND id = $2
     RETURNING ${DEVICE_COLUMNS}`,
    [workspaceId, id],
  );
  return rows[0] ?? null;
}

export async function revokeAllDevices(db: Queryable, workspaceId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `WITH gone AS (DELETE FROM remote_passkeys WHERE workspace_id = $1),
       push_gone AS (DELETE FROM remote_push_subscriptions WHERE workspace_id = $1)
     UPDATE remote_devices SET revoked_at = now()
     WHERE workspace_id = $1 AND revoked_at IS NULL RETURNING id`,
    [workspaceId],
  );
  return rows.map((row) => row.id);
}

export interface AuditInput {
  action: RemoteAuditAction;
  device?: { id: string; name: string } | null;
  method?: string;
  path?: string;
  status?: number;
  detail?: Record<string, string | number | boolean | null | undefined>;
}

export async function recordRemoteAudit(
  db: Queryable,
  workspaceId: string,
  entry: AuditInput,
): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO remote_audit
       (id, workspace_id, device_id, device_name, action, method, path, status, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      workspaceId,
      entry.device?.id ?? null,
      entry.device?.name ?? null,
      entry.action,
      entry.method ?? null,
      entry.path ?? null,
      entry.status ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
  return id;
}

export async function recordPairingPageShown(
  db: Queryable,
  workspaceId: string,
  device: { id: string; name: string } | null,
  reason: string,
  everySeconds: number,
): Promise<void> {
  await db.query(
    `INSERT INTO remote_audit (id, workspace_id, device_id, device_name, action, detail)
     SELECT $1, $2, $3, $4, 'pairing_page_shown', $5::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM remote_audit
       WHERE workspace_id = $2 AND action = 'pairing_page_shown'
         AND device_id IS NOT DISTINCT FROM $3
         AND detail->>'reason' = $6
         AND created_at > now() - make_interval(secs => $7)
     )`,
    [
      newId(),
      workspaceId,
      device?.id ?? null,
      device?.name ?? null,
      JSON.stringify({ reason }),
      reason,
      everySeconds,
    ],
  );
}

export async function setRemoteAuditStatus(
  db: Queryable,
  id: string,
  status: number,
): Promise<void> {
  await db.query('UPDATE remote_audit SET status = $2 WHERE id = $1', [id, status]);
}

interface AuditRow {
  id: string;
  created_at: Date;
  action: RemoteAuditAction;
  device_id: string | null;
  device_name: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  detail: Record<string, unknown>;
}

const AUDIT_PAGE = 200;

export async function listRemoteAudit(
  db: Queryable,
  workspaceId: string,
): Promise<RemoteAuditEntry[]> {
  const { rows } = await db.query<AuditRow>(
    `SELECT id, created_at, action, device_id, device_name, method, path, status, detail
     FROM remote_audit WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [workspaceId, AUDIT_PAGE],
  );
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at.toISOString(),
    action: row.action,
    deviceId: row.device_id,
    deviceName: row.device_name,
    method: row.method,
    path: row.path,
    status: row.status,
    detail: row.detail,
  }));
}

export async function pruneRemoteAudit(db: Db, retentionDays: number): Promise<void> {
  await db.query(`DELETE FROM remote_audit WHERE created_at < now() - make_interval(days => $1)`, [
    retentionDays,
  ]);
}

export async function approvalPayload(
  db: Queryable,
  workspaceId: string,
  approvalId: string,
): Promise<unknown> {
  const { rows } = await db.query<{ payload: unknown }>(
    `SELECT a.payload FROM approvals a
     JOIN runs r ON r.id = a.run_id
     JOIN conversations c ON c.id = r.conversation_id
     WHERE a.id = $1 AND c.workspace_id = $2`,
    [approvalId, workspaceId],
  );
  return rows[0]?.payload ?? null;
}

export async function serveTarget(db: Queryable, workspaceId: string): Promise<string | null> {
  const { rows } = await db.query<{ serve_target: string | null }>(
    'SELECT serve_target FROM remote_access_settings WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows[0]?.serve_target ?? null;
}

export async function saveServeTarget(
  db: Queryable,
  workspaceId: string,
  target: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO remote_access_settings (workspace_id, serve_target) VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE SET serve_target = $2, updated_at = now()`,
    [workspaceId, target],
  );
}
