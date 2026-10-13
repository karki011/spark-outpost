import { API_TOKEN_HEADER } from '../../packages/contracts/src/api-token.ts';
import type { Db } from '../../apps/server/src/persistence/db.ts';
import { API_PORT } from './stub-config.ts';

const STOP_WAIT_MS = 5000;

async function stopTerminal(conversationId: string): Promise<void> {
  const token = process.env.SPARK_BROWSER_API_TOKEN;
  await fetch(`http://127.0.0.1:${API_PORT}/api/conversations/${conversationId}/terminal`, {
    method: 'DELETE',
    headers: token ? { [API_TOKEN_HEADER]: token } : {},
    signal: AbortSignal.timeout(STOP_WAIT_MS),
  }).catch(() => undefined);
}

export async function stopLeftoverTerminals(db: Db): Promise<void> {
  const { rows } = await db.query<{ conversation_id: string }>(
    'SELECT conversation_id FROM native_terminal_sessions',
  );
  await Promise.all(rows.map((row) => stopTerminal(row.conversation_id)));
}
