import { describe, expect, it } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { invalidateLive } from './invalidate-live.ts';

const KEY = ['conversations'];

interface Gate {
  started: number;
  release: () => void;
}

function gatedList(client: QueryClient): Gate {
  const waiting: (() => void)[] = [];
  const gate: Gate = {
    started: 0,
    release: () => waiting.shift()?.(),
  };
  const observer = new QueryObserver(client, {
    queryKey: KEY,
    staleTime: Infinity,
    queryFn: () => {
      gate.started += 1;
      const call = gate.started;
      return new Promise<number>((resolve) => waiting.push(() => resolve(call)));
    },
  });
  observer.subscribe(() => undefined);
  return gate;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('invalidateLive', () => {
  it('starts a fetch at once when none is in flight', async () => {
    const client = new QueryClient();
    const gate = gatedList(client);
    gate.release();
    await settle();
    invalidateLive(client, { queryKey: KEY, exact: true });
    expect(gate.started).toBe(2);
  });

  it('leaves a running fetch alone and follows it with one fetch that started after the last event', async () => {
    const client = new QueryClient();
    const gate = gatedList(client);
    gate.release();
    await settle();
    invalidateLive(client, { queryKey: KEY, exact: true });
    invalidateLive(client, { queryKey: KEY, exact: true });
    invalidateLive(client, { queryKey: KEY, exact: true });
    expect(gate.started).toBe(2);
    gate.release();
    await settle();
    expect(gate.started).toBe(3);
    gate.release();
    await settle();
    expect(gate.started).toBe(3);
    expect(client.getQueryData(KEY)).toBe(3);
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(false);
  });

  it('does not repeat a first load that an event arrived during', async () => {
    const client = new QueryClient();
    const gate = gatedList(client);
    expect(gate.started).toBe(1);
    invalidateLive(client, { queryKey: KEY, exact: true });
    gate.release();
    await settle();
    expect(gate.started).toBe(1);
    expect(client.getQueryData(KEY)).toBe(1);
  });

  it('leaves a prefetch of a cached chat nobody is showing to finish by itself', async () => {
    const client = new QueryClient();
    client.setQueryData(KEY, 0);
    let started = 0;
    let release: () => void = () => undefined;
    const prefetch = client.prefetchQuery({
      queryKey: KEY,
      queryFn: () => {
        started += 1;
        return new Promise<number>((resolve) => {
          release = () => resolve(1);
        });
      },
    });
    invalidateLive(client, { queryKey: KEY, exact: true });
    await settle();
    expect(started).toBe(1);
    release();
    await prefetch;
    await settle();
    expect(started).toBe(1);
    invalidateLive(client, { queryKey: KEY, exact: true });
    expect(client.getQueryState(KEY)?.isInvalidated).toBe(true);
  });
});
