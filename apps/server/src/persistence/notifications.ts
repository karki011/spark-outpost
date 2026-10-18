import pg from 'pg';
import { searchPathOptions } from './db.ts';

const RELISTEN_MS = 2_000;

export interface NotificationListener {
  close(): Promise<void>;
}

export interface ListenOptions {
  searchPath?: string;
  onError?: (error: Error) => void;
}

export async function listen(
  connectionString: string,
  channel: 'run_events' | 'jobs' | 'approvals' | 'changes' | 'pr_poll' | 'calendar_written',
  onPayload: (payload: string) => void,
  { searchPath, onError }: ListenOptions = {},
): Promise<NotificationListener> {
  const client = new pg.Client({ connectionString, ...searchPathOptions(searchPath) });
  client.on('error', (error) => {
    console.error(
      `Notification listener on ${channel} failed; falling back to polling.`,
      error.message,
    );
    onError?.(error);
  });
  client.on('notification', (message) => onPayload(message.payload ?? ''));
  try {
    await client.connect();
    await client.query(`LISTEN ${channel}`);
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
  return {
    async close() {
      await client.end().catch(() => undefined);
    },
  };
}

export interface KeepListeningOptions {
  searchPath?: string;
  onLost?: () => void;
  onBack?: () => void;
}

export async function keepListening(
  connectionString: string,
  channel: 'changes',
  onPayload: (payload: string) => void,
  { searchPath, onLost, onBack }: KeepListeningOptions = {},
): Promise<NotificationListener> {
  let current: NotificationListener | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () =>
    listen(connectionString, channel, onPayload, {
      ...(searchPath ? { searchPath } : {}),
      onError: lost,
    });

  function lost() {
    if (closed || retry) return;
    onLost?.();
    void current?.close();
    current = null;
    scheduleReconnect();
  }

  function scheduleReconnect() {
    retry = setTimeout(async () => {
      if (closed) return;
      try {
        const next = await connect();
        retry = null;
        if (closed) {
          await next.close();
          return;
        }
        current = next;
        onBack?.();
      } catch {
        retry = null;
        scheduleReconnect();
      }
    }, RELISTEN_MS);
  }

  current = await connect();
  return {
    async close() {
      closed = true;
      if (retry) clearTimeout(retry);
      await current?.close();
    },
  };
}
