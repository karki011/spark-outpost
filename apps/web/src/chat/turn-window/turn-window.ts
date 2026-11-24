export const INITIAL_TURNS = 8;
export const IDLE_BATCH = 3;

export type MountedTurns = ReadonlySet<string>;

export function tailTurns(ids: readonly string[]): string[] {
  return ids.slice(-INITIAL_TURNS);
}

export function withMounted(mounted: MountedTurns, ids: readonly string[]): MountedTurns {
  const added = ids.filter((id) => !mounted.has(id));
  return added.length === 0 ? mounted : new Set([...mounted, ...added]);
}

export function deferredTurns(ids: readonly string[], mounted: MountedTurns): string[] {
  return ids.filter((id) => !mounted.has(id));
}

export function nextIdleBatch(ids: readonly string[], mounted: MountedTurns): string[] {
  return deferredTurns(ids, mounted).slice(-IDLE_BATCH);
}
