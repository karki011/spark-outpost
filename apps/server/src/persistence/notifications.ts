import pg from 'pg';

export interface NotificationListener {
  close(): Promise<void>;
}

export async function listen(
  connectionString: string,
  channel: 'run_events' | 'jobs' | 'approvals',
  onPayload: (payload: string) => void,
  searchPath?: string,
): Promise<NotificationListener> {
  const options = searchPath ? `-c search_path=${searchPath}` : undefined;
  const client = new pg.Client({ connectionString, ...(options ? { options } : {}) });
  client.on('error', (error) => {
    console.error(
      `Notification listener on ${channel} failed; falling back to polling.`,
      error.message,
    );
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
