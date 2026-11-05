import type { Db, Queryable } from '../persistence/db.ts';
import type { ModeRequests } from '../providers/provider.ts';

export interface ModeRequestWatch extends ModeRequests {
  dispose(): void;
}

async function requestedMode(db: Db, runId: string): Promise<string | null> {
  const { rows } = await db.query<{ requested_mode: string | null }>(
    'SELECT requested_mode FROM runs WHERE id = $1',
    [runId],
  );
  return rows[0]?.requested_mode ?? null;
}

export async function requestModeChange(
  db: Queryable,
  conversationId: string,
  provider: string,
  mode: string,
): Promise<void> {
  await db.query(
    `UPDATE runs SET
       agent_mode = CASE WHEN status = 'queued' THEN $3 ELSE agent_mode END,
       requested_mode = CASE WHEN status = 'queued' THEN requested_mode ELSE $3 END
     WHERE conversation_id = $1 AND provider = $2 AND mode = 'do'
       AND status IN ('queued', 'running', 'awaiting_approval')
       AND role IS NULL`,
    [conversationId, provider, mode],
  );
}

export function watchModeRequests(db: Db, runId: string, pollMs: number): ModeRequestWatch {
  const listeners = new Set<(mode: string) => void>();
  let last: string | null = null;
  let started = false;
  const poll = async () => {
    const mode = await requestedMode(db, runId);
    if (!started) {
      started = true;
      last = mode;
      return;
    }
    if (mode === null || mode === last) return;
    last = mode;
    for (const listener of listeners) listener(mode);
  };
  void poll().catch(() => undefined);
  const timer = setInterval(() => void poll().catch(() => undefined), pollMs);
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      clearInterval(timer);
      listeners.clear();
    },
  };
}
