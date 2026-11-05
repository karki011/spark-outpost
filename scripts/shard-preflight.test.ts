import { describe, expect, it } from 'vitest';
import { preflight } from './shard-preflight.ts';
import { connectionShortfall } from './test-selection.ts';

function database(inUse: number, max: number, stacks: number) {
  const state = { inUse, checked: false };
  return {
    state,
    connectionShortage: async () => {
      state.checked = true;
      const short = connectionShortfall(stacks, max, state.inUse);
      return short > 0 ? `${short} short` : null;
    },
  };
}

describe('shard preflight', () => {
  it('measures Postgres capacity after leftover stacks are stopped', async () => {
    const db = database(100, 160, 6);
    const result = await preflight({
      clearSlots: async () => {
        db.state.inUse = 10;
        return true;
      },
      connectionShortage: db.connectionShortage,
    });
    expect(result).toEqual({ kind: 'ready' });
  });

  it('still reports a shortage that stopping leftovers did not fix', async () => {
    const db = database(150, 160, 6);
    const result = await preflight({
      clearSlots: async () => true,
      connectionShortage: db.connectionShortage,
    });
    expect(result).toMatchObject({ kind: 'short' });
  });

  it('checks no capacity when a slot is held by something it may not stop', async () => {
    const db = database(10, 160, 6);
    const result = await preflight({
      clearSlots: async () => false,
      connectionShortage: db.connectionShortage,
    });
    expect(result).toEqual({ kind: 'blocked' });
    expect(db.state.checked).toBe(false);
  });
});
