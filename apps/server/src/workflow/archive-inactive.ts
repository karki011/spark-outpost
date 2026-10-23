import { archivedInactiveLine } from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  archiveIfInactive,
  archiveInactiveSetting,
  inactiveChats,
  stillArchived,
} from '../persistence/inactive-chats.ts';
import { finishArchive, type ArchiveTerminals } from './archive-chat.ts';

const SWEEP_EVERY_MS = 60 * 60 * 1000;
const FIRST_SWEEP_MS = 5_000;

async function notifyArchived(db: Db, conversationId: string): Promise<void> {
  await db.query(`SELECT pg_notify('changes', $1)`, [
    JSON.stringify({ kind: 'conversation', conversationId, runId: null }),
  ]);
}

export async function archiveInactive(
  db: Db,
  workspaceId: string,
  terminals?: ArchiveTerminals,
): Promise<string[]> {
  const days = await archiveInactiveSetting(db, workspaceId);
  if (days === null) return [];
  const archived: string[] = [];
  for (const id of await inactiveChats(db, workspaceId, days)) {
    if (!(await archiveIfInactive(db, workspaceId, id, days))) continue;
    archived.push(id);
    if (await stillArchived(db, id)) {
      await finishArchive(db, workspaceId, id, terminals, archivedInactiveLine(days));
    }
    await notifyArchived(db, id);
  }
  return archived;
}

export interface ArchiveSweep {
  stop(): void;
}

export function startArchiveSweep(
  db: Db,
  workspaceId: string,
  terminals?: ArchiveTerminals,
): ArchiveSweep {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await archiveInactive(db, workspaceId, terminals);
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
