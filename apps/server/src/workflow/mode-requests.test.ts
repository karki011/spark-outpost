import { describe, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { dispatchRunSignal } from '../persistence/run-signals.ts';
import { watchModeRequests } from './mode-requests.ts';

function fakeDb(state: { mode: string | null }): Db {
  return {
    query: async () => ({ rows: [{ requested_mode: state.mode }] }),
  } as unknown as Db;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('watchModeRequests', () => {
  it('gives a request made before anyone subscribed to the first subscriber, once', async () => {
    const state = { mode: null as string | null };
    const watch = watchModeRequests(fakeDb(state), 'run-1', 60_000);
    await settle();
    state.mode = 'plan';
    dispatchRunSignal('run-1');
    await settle();
    const first: string[] = [];
    const second: string[] = [];
    watch.subscribe((mode) => first.push(mode));
    watch.subscribe((mode) => second.push(mode));
    expect(first).toEqual(['plan']);
    expect(second).toEqual([]);
    state.mode = 'auto';
    dispatchRunSignal('run-1');
    await settle();
    expect(first).toEqual(['plan', 'auto']);
    expect(second).toEqual(['auto']);
    watch.dispose();
  });

  it('treats the mode already on the run when watching starts as applied', async () => {
    const state = { mode: 'plan' as string | null };
    const watch = watchModeRequests(fakeDb(state), 'run-2', 60_000);
    await settle();
    const heard: string[] = [];
    watch.subscribe((mode) => heard.push(mode));
    dispatchRunSignal('run-2');
    await settle();
    expect(heard).toEqual([]);
    watch.dispose();
  });
});
