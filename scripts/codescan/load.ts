import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';

export interface LoadStats {
  requests: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  loopDelayP99Ms: number;
}

export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return Math.round((sorted[Math.max(0, index)] ?? 0) * 10) / 10;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function underLoad<T>(
  work: () => Promise<T>,
  gapMs = 20,
): Promise<{ result: T; api: LoadStats }> {
  const server = createServer((_request, response) => response.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const latencies: number[] = [];
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  let running = true;
  const loop = (async () => {
    while (running) {
      const started = performance.now();
      await (await fetch(`http://127.0.0.1:${port}/`)).text();
      latencies.push(performance.now() - started);
      await pause(gapMs);
    }
  })();
  try {
    const result = await work();
    return {
      result,
      api: {
        requests: latencies.length,
        p50Ms: percentile(latencies, 0.5),
        p95Ms: percentile(latencies, 0.95),
        maxMs: Math.round(Math.max(0, ...latencies)),
        loopDelayP99Ms: Math.round(delay.percentile(99) / 1e6),
      },
    };
  } finally {
    running = false;
    await loop;
    delay.disable();
    await new Promise((resolve) => server.close(resolve));
  }
}
