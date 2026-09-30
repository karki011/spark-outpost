import { noteSection } from '../coordinator/notes.ts';
import type { Db } from '../persistence/db.ts';
import { markNotesDelivered, urgentNotesForRun } from '../persistence/piece-notes.ts';
import type { SteerRequests } from '../providers/provider.ts';

export interface SteerWatch extends SteerRequests {
  dispose(): void;
}

export function watchUrgentNotes(
  db: Db,
  runId: string,
  pollMs: number,
  interrupt: () => void,
): SteerWatch {
  let send: ((text: string) => Promise<boolean>) | null = null;
  let busy = false;
  let done = false;
  const poll = async () => {
    if (busy || done) return;
    busy = true;
    try {
      const notes = await urgentNotesForRun(db, runId);
      const text = noteSection(notes);
      if (!text) return;
      if (send && (await send(text))) {
        await markNotesDelivered(
          db,
          notes.map((note) => note.id),
          runId,
        );
        return;
      }
      done = true;
      interrupt();
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void poll().catch(() => undefined), pollMs);
  return {
    attach(sender) {
      send = sender;
      return () => {
        send = null;
      };
    },
    dispose() {
      done = true;
      clearInterval(timer);
    },
  };
}
