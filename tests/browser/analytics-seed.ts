import { createDb } from '../../apps/server/src/persistence/db.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { seedRealisticAnalytics } from '../../apps/server/test/analytics-realistic.ts';
import { testDatabaseUrl } from './database.ts';

export async function seedAnalytics(days = 90): Promise<number> {
  const db = createDb(testDatabaseUrl());
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    return await seedRealisticAnalytics(db, workspaceId, { days });
  } finally {
    await db.end();
  }
}
