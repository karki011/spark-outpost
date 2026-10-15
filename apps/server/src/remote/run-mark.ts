import { AsyncLocalStorage } from 'node:async_hooks';
import type { Queryable } from '../persistence/db.ts';

const requestDevice = new AsyncLocalStorage<string>();

const TERMINAL_TYPING_WINDOW = '2 minutes';

export function asDevice<T>(deviceId: string, run: () => T): T {
  return requestDevice.run(deviceId, run);
}

export function deviceOfRequest(): string | null {
  return requestDevice.getStore() ?? null;
}

export async function rememberRemoteMessage(db: Queryable, messageId: string): Promise<void> {
  const device = deviceOfRequest();
  if (!device) return;
  await db.query(
    `INSERT INTO remote_messages (message_id, device_id) VALUES ($1, $2)
     ON CONFLICT (message_id) DO NOTHING`,
    [messageId, device],
  );
}

export async function rememberRemoteTyping(db: Queryable, conversationId: string): Promise<void> {
  const device = deviceOfRequest();
  if (!device) return;
  await db.query(
    `UPDATE conversations SET remote_typed_device_id = $2, remote_typed_at = now() WHERE id = $1`,
    [conversationId, device],
  );
}

export async function deviceStartingRun(
  db: Queryable,
  conversationId: string,
  messageId: string,
  terminal: boolean,
): Promise<string | null> {
  const fromRequest = deviceOfRequest();
  if (fromRequest) return fromRequest;
  const queued = await db.query<{ device_id: string }>(
    'DELETE FROM remote_messages WHERE message_id = $1 RETURNING device_id',
    [messageId],
  );
  if (queued.rows[0]) return queued.rows[0].device_id;
  if (!terminal) return null;
  const typed = await db.query<{ device: string }>(
    `UPDATE conversations c SET remote_typed_device_id = NULL, remote_typed_at = NULL
     FROM (SELECT remote_typed_device_id AS device FROM conversations
           WHERE id = $1 AND remote_typed_at > now() - interval '${TERMINAL_TYPING_WINDOW}'
           FOR UPDATE) typed
     WHERE c.id = $1 RETURNING typed.device`,
    [conversationId],
  );
  return typed.rows[0]?.device ?? null;
}

export async function runFromDevice(db: Queryable, runId: string): Promise<boolean> {
  const { rows } = await db.query<{ remote: boolean }>(
    `SELECT (r.remote_device_id IS NOT NULL
             OR (p.id IS NOT NULL AND p.remote_device_id IS NOT NULL)) AS remote
     FROM runs r LEFT JOIN runs p ON p.id = r.parent_run_id WHERE r.id = $1`,
    [runId],
  );
  return rows[0]?.remote === true;
}
