import pg from 'pg';

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
  const options = searchPath ? `-c search_path=${searchPath}` : undefined;
  const client = new pg.Client({ connectionString, ...(options ? { options } : {}) });
  client.on('error', (error) => {
    console.error(
      `Notification listener on ${channel} failed; falling back to polling.`,
      error.message,
    );
    onError?.(error);
  });
  client.on('notification', (message) => onPayload(message.payload ?? ''));
  await client.connect();
  await client.query(`LISTEN ${channel}`);
  return {
    async close() {
      await client.end().catch(() => undefined);
    },
  };
}
