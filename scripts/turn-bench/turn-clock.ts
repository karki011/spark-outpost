import type { Db } from '../../apps/server/src/persistence/db.ts';

const FALLBACK_POLL_MS = 10;

export interface TurnTimes {
  firstTextMs: number;
  doneMs: number;
}

export interface TurnWatch {
  start(runId: string): void;
  notified(runId: string): void;
  result(timeoutMs: number): Promise<TurnTimes>;
}

export function newTurnWatch(db: Db): TurnWatch {
  const began = performance.now();
  let runId: string | null = null;
  let firstTextAt: number | null = null;
  let doneAt: number | null = null;
  let status: string | null = null;
  let checking = false;
  let again = false;
  let finish: (() => void) | null = null;

  const look = async () => {
    const at = performance.now();
    if (firstTextAt === null) {
      const { rows } = await db.query(
        `SELECT 1 FROM run_events WHERE run_id = $1 AND type LIKE 'TEXT_MESSAGE%' LIMIT 1`,
        [runId],
      );
      if (rows.length > 0) firstTextAt = at;
    }
    if (doneAt === null) {
      const { rows } = await db.query('SELECT finished_at, status FROM runs WHERE id = $1', [
        runId,
      ]);
      if (rows[0]?.finished_at) {
        doneAt = performance.now();
        status = rows[0].status;
      }
    }
    if (doneAt !== null) finish?.();
  };

  const poke = async () => {
    if (runId === null || doneAt !== null) return;
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      do {
        again = false;
        await look();
      } while (again && doneAt === null);
    } finally {
      checking = false;
    }
  };

  return {
    start(id) {
      runId = id;
      void poke();
    },
    notified(id) {
      if (id === runId) void poke();
    },
    async result(timeoutMs) {
      const timer = setInterval(() => void poke(), FALLBACK_POLL_MS);
      let deadline: NodeJS.Timeout | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          finish = resolve;
          deadline = setTimeout(
            () => reject(new Error(`Turn did not finish within ${timeoutMs} ms.`)),
            timeoutMs,
          );
          if (doneAt !== null) resolve();
        });
      } finally {
        clearInterval(timer);
        clearTimeout(deadline);
      }
      if (status !== 'succeeded') throw new Error(`The turn ended as ${status}, not succeeded.`);
      if (firstTextAt === null) throw new Error('The turn finished without any reply text.');
      return { firstTextMs: firstTextAt - began, doneMs: doneAt! - began };
    },
  };
}
