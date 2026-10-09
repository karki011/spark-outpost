import { REMOTE_DEVICE_IDLE_DAYS } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { newId } from '../persistence/ids.ts';

export interface PasskeyRow {
  id: string;
  device_id: string;
  credential_id: string;
  transports: string[];
  synced: boolean;
  label: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

const PASSKEY_COLUMNS =
  'id, device_id, credential_id, transports, synced, label, created_at, last_used_at';

export async function listPasskeys(db: Queryable, workspaceId: string): Promise<PasskeyRow[]> {
  const { rows } = await db.query<PasskeyRow>(
    `SELECT ${PASSKEY_COLUMNS} FROM remote_passkeys WHERE workspace_id = $1
     ORDER BY created_at, id`,
    [workspaceId],
  );
  return rows;
}

export async function devicePasskeys(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
): Promise<PasskeyRow[]> {
  const { rows } = await db.query<PasskeyRow>(
    `SELECT ${PASSKEY_COLUMNS} FROM remote_passkeys WHERE workspace_id = $1 AND device_id = $2
     ORDER BY created_at, id`,
    [workspaceId, deviceId],
  );
  return rows;
}

export interface NewPasskey {
  deviceId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  synced: boolean;
  label: string | null;
}

export async function addPasskey(
  db: Queryable,
  workspaceId: string,
  passkey: NewPasskey,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO remote_passkeys
       (id, workspace_id, device_id, credential_id, public_key, sign_count, transports, synced, label)
     SELECT $1, $2, d.id, $4, $5, $6, $7, $8, $9 FROM remote_devices d
     WHERE d.workspace_id = $2 AND d.id = $3 AND d.revoked_at IS NULL
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      newId(),
      workspaceId,
      passkey.deviceId,
      passkey.credentialId,
      Buffer.from(passkey.publicKey),
      passkey.counter,
      passkey.transports,
      passkey.synced,
      passkey.label,
    ],
  );
  return rowCount === 1;
}

export interface SignInPasskey {
  id: string;
  public_key: Buffer;
  sign_count: string;
  device_id: string;
  device_name: string;
  revoked: boolean;
  expired: boolean;
}

export async function passkeyForSignIn(
  db: Queryable,
  workspaceId: string,
  credentialId: string,
): Promise<SignInPasskey | null> {
  const { rows } = await db.query<SignInPasskey>(
    `SELECT p.id, p.public_key, p.sign_count, d.id AS device_id, d.name AS device_name,
       d.revoked_at IS NOT NULL AS revoked,
       d.last_seen_at < now() - interval '${REMOTE_DEVICE_IDLE_DAYS} days' AS expired
     FROM remote_passkeys p JOIN remote_devices d ON d.id = p.device_id
     WHERE p.workspace_id = $1 AND p.credential_id = $2`,
    [workspaceId, credentialId],
  );
  return rows[0] ?? null;
}

export interface PasskeySignIn {
  passkeyId: string;
  deviceId: string;
  counter: number;
  tokenHash: string;
}

export async function recordPasskeySignIn(
  db: Queryable,
  workspaceId: string,
  signIn: PasskeySignIn,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `WITH device AS (
       UPDATE remote_devices SET last_seen_at = now()
       WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
         AND last_seen_at >= now() - interval '${REMOTE_DEVICE_IDLE_DAYS} days'
       RETURNING id
     ), used AS (
       UPDATE remote_passkeys SET sign_count = $4, last_used_at = now()
       WHERE id = $3 AND device_id IN (SELECT id FROM device)
       RETURNING id
     )
     INSERT INTO remote_device_sessions (token_hash, device_id, passkey_id)
     SELECT $5, device.id, used.id FROM device, used`,
    [workspaceId, signIn.deviceId, signIn.passkeyId, signIn.counter, signIn.tokenHash],
  );
  return rowCount === 1;
}

export async function removeDevicePasskeys(
  db: Queryable,
  workspaceId: string,
  deviceId: string,
): Promise<number> {
  const { rowCount } = await db.query(
    'DELETE FROM remote_passkeys WHERE workspace_id = $1 AND device_id = $2',
    [workspaceId, deviceId],
  );
  return rowCount ?? 0;
}
