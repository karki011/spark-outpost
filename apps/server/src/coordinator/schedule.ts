import { dependencyOrder } from './graph.ts';

export interface Schedulable {
  key: string;
  dependsOn: readonly string[];
}

export interface Schedule<T extends Schedulable> {
  limit: number;
  narrowed?(): boolean;
  settled: ReadonlySet<string>;
  stopped(): boolean;
  run(piece: T, slot: number): Promise<PieceEnd>;
}

export type PieceEnd = 'landed' | 'skipped' | 'failed';

export interface Scheduled {
  landed: Set<string>;
  failed: boolean;
}

function isReady(piece: Schedulable, landed: ReadonlySet<string>, keys: ReadonlySet<string>) {
  return piece.dependsOn.every((dep) => landed.has(dep) || !keys.has(dep));
}

export async function runReadySet<T extends Schedulable>(
  pieces: readonly T[],
  schedule: Schedule<T>,
): Promise<Scheduled> {
  const keys = new Set(pieces.map((piece) => piece.key));
  const landed = new Set([...schedule.settled].filter((key) => keys.has(key)));
  const waiting = dependencyOrder(pieces).filter((piece) => !landed.has(piece.key));
  const free = Array.from({ length: Math.max(1, schedule.limit) }, (_, index) => index + 1);
  const running = new Map<string, Promise<void>>();
  let failed = false;
  const errors: unknown[] = [];
  const start = (piece: T, slot: number) => {
    const done = schedule.run(piece, slot).then(
      (end) => {
        if (end === 'failed') failed = true;
        else landed.add(piece.key);
      },
      (error: unknown) => {
        errors.push(error);
        failed = true;
      },
    );
    running.set(
      piece.key,
      done.finally(() => {
        running.delete(piece.key);
        free.push(slot);
        free.sort((a, b) => a - b);
      }),
    );
  };
  for (;;) {
    const open = () => (schedule.narrowed?.() ? running.size === 0 : free.length > 0);
    while (!failed && !schedule.stopped() && open()) {
      const next = waiting.findIndex((piece) => isReady(piece, landed, keys));
      if (next === -1) break;
      const [piece] = waiting.splice(next, 1);
      start(piece!, free.shift()!);
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  if (errors.length > 0) throw errors[0];
  return { landed, failed };
}
