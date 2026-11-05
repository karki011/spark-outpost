import { withTransaction } from '../../apps/server/src/persistence/db.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedRealisticAnalytics } from '../../apps/server/test/analytics-realistic.ts';
import { openTestDb } from './database.ts';

export async function seedAnalytics(days = 90): Promise<number> {
  const db = openTestDb();
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    return await withTransaction(db, (client) =>
      seedRealisticAnalytics(client, workspaceId, { days }),
    );
  } finally {
    await db.end();
  }
}
