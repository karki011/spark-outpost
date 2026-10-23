import { archivedInactiveLine } from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';
import {
  archiveInactiveSetting,
  inactiveChats,
  markArchivedIfInactive,
  type Days,
} from '../persistence/inactive-chats.ts';
import { finishArchive } from './archive-chat.ts';

const SWEEP_EVERY_MS = 60 * 60 * 1000;
const FIRST_SWEEP_MS = 5_000;

export async function archiveIfInactive(
  db: Db,
  workspaceId: string,
  conversationId: string,
  days: Days,
): Promise<boolean> {
  return withTransaction(db, async (client) => {
    if (!(await markArchivedIfInactive(client, workspaceId, conversationId, days))) return false;
    await finishArchive(client, workspaceId, conversationId, undefined, archivedInactiveLine(days));
    return true;
  });
}

async function notifyArchived(db: Db, conversationId: string): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'conversation', conversationId, runId: null }),
  ]);
}

export async function archiveInactive(db: Db, workspaceId: string): Promise<string[]> {
  const days = await archiveInactiveSetting(db, workspaceId);
  if (days === null) return [];
  const archived: string[] = [];
  for (const id of await inactiveChats(db, workspaceId, days)) {
    const done = await archiveIfInactive(db, workspaceId, id, days).catch((error: unknown) => {
      console.error(`Could not archive inactive chat ${id}; the next sweep tries again`, error);
      return false;
    });
    if (!done) continue;
    archived.push(id);
    await notifyArchived(db, id);
  }
  return archived;
}

export interface ArchiveSweep {
  stop(): void;
}

export function startArchiveSweep(db: Db, workspaceId: string): ArchiveSweep {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await archiveInactive(db, workspaceId);
    } catch (error) {
      console.error('Could not archive inactive chats', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), SWEEP_EVERY_MS);
  timer.unref();
  const first = setTimeout(() => void tick(), FIRST_SWEEP_MS);
  first.unref();
  return {
    stop() {
      clearInterval(timer);
      clearTimeout(first);
    },
  };
}
