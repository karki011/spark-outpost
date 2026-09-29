import pg from 'pg';
import { searchPathOptions } from './db.ts';

export interface NotificationListener {
  close(): Promise<void>;
}

export interface ListenOptions {
  searchPath?: string;
  onError?: (error: Error) => void;
}

export async function listen(
  connectionString: string,
  channel: 'run_events' | 'jobs' | 'approvals' | 'changes',
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
