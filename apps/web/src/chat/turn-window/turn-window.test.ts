import { describe, expect, it } from 'vitest';
import {
  IDLE_BATCH,
  INITIAL_TURNS,
  deferredTurns,
  nextIdleBatch,
  tailTurns,
  withMounted,
} from './turn-window.ts';

const ids = Array.from({ length: 20 }, (_, index) => `run-${index}`);

describe('turn window', () => {
  it('starts with the newest turns', () => {
    expect(tailTurns(ids)).toEqual(ids.slice(-INITIAL_TURNS));
    expect(tailTurns(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('keeps the same set when nothing new is mounted', () => {
    const mounted = new Set(['a', 'b']);
    expect(withMounted(mounted, ['b', 'a'])).toBe(mounted);
    expect(withMounted(mounted, [])).toBe(mounted);
  });

  it('adds turns without dropping mounted ones', () => {
    const mounted = new Set(['a']);
    const grown = withMounted(mounted, ['b', 'a']);
    expect([...grown]).toEqual(['a', 'b']);
    expect([...mounted]).toEqual(['a']);
  });

  it('lists deferred turns in thread order', () => {
    expect(deferredTurns(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
  });

  it('mounts the turns nearest the newest first when idle', () => {
    const mounted = new Set(tailTurns(ids));
    expect(nextIdleBatch(ids, mounted)).toEqual(
      ids.slice(-INITIAL_TURNS - IDLE_BATCH, -INITIAL_TURNS),
    );
  });

  it('reaches every turn and then stops', () => {
    let mounted = withMounted(new Set<string>(), tailTurns(ids));
    let rounds = 0;
    for (let batch = nextIdleBatch(ids, mounted); batch.length > 0; rounds += 1) {
      mounted = withMounted(mounted, batch);
      batch = nextIdleBatch(ids, mounted);
    }
    expect(deferredTurns(ids, mounted)).toEqual([]);
    expect(rounds).toBe(Math.ceil((ids.length - INITIAL_TURNS) / IDLE_BATCH));
  });

  it('keeps a turn mounted after newer turns push it out of the tail', () => {
    const before = withMounted(new Set<string>(), tailTurns(ids));
    const after = withMounted(before, tailTurns([...ids, 'run-20', 'run-21']));
    expect(after.has(ids[ids.length - INITIAL_TURNS]!)).toBe(true);
    expect(after.has('run-21')).toBe(true);
  });
});
