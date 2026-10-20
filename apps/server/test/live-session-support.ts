import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderOutput, StoredSession } from '../src/providers/provider.ts';

export interface MethodLog {
  file: string;
  methods(): string[];
  pids(): Set<string>;
  count(method: string): number;
}

export function methodLog(dir: string): MethodLog {
  const file = join(dir, `methods-${crypto.randomUUID()}.log`);
  const lines = () =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split(' ') as [string, string])
      : [];
  return {
    file,
    methods: () => lines().map(([, method]) => method),
    pids: () => new Set(lines().map(([pid]) => pid)),
    count: (method) => lines().filter(([, logged]) => logged === method).length,
  };
}

export function sessionOf(outputs: readonly ProviderOutput[]): StoredSession | null {
  const opened = outputs.find((output) => output.kind === 'session');
  if (opened?.kind !== 'session') return null;
  return {
    sessionId: opened.sessionId,
    cwd: opened.cwd,
    additionalDirectories: opened.additionalDirectories,
  };
}

export async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the live session.');
    await delay(20);
  }
}
