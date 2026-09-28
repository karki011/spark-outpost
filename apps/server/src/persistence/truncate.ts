import { withTransaction, type Db } from './db.ts';

const LOCK_NOT_AVAILABLE = '55P03';
const TRUNCATE_LOCK_TIMEOUT_MS = 200;

export interface TruncateOptions {
  tries?: number;
  retryMs?: number;
}

function isLockTimeout(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === LOCK_NOT_AVAILABLE;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function truncateTables(
  db: Db,
  tables: readonly string[],
  { tries = 100, retryMs = 50 }: TruncateOptions = {},
): Promise<void> {
  const statement = `TRUNCATE ${tables.map((table) => `"${table}"`).join(', ')} CASCADE`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await withTransaction(db, async (client) => {
        await client.query(`SET LOCAL lock_timeout = '${TRUNCATE_LOCK_TIMEOUT_MS}ms'`);
        await client.query(statement);
      });
      return;
    } catch (error) {
      if (attempt >= tries || !isLockTimeout(error)) throw error;
      await pause(retryMs);
    }
  }
}
