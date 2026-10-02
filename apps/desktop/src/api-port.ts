import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STABLE_PORTS = { first: 30_000, last: 39_999 } as const;
const TRIES = 20;

export interface PortChoice {
  saved: number | null;
  isFree: (port: number) => Promise<boolean>;
  random: () => number;
  fallback: () => Promise<number>;
}

export function isStablePort(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= STABLE_PORTS.first &&
    (value as number) <= STABLE_PORTS.last
  );
}

export function randomStablePort(): number {
  const span = STABLE_PORTS.last - STABLE_PORTS.first + 1;
  return STABLE_PORTS.first + Math.floor(Math.random() * span);
}

export async function chooseApiPort(choice: PortChoice): Promise<number> {
  if (choice.saved !== null && (await choice.isFree(choice.saved))) return choice.saved;
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const candidate = choice.random();
    if (candidate !== choice.saved && (await choice.isFree(candidate))) return candidate;
  }
  return choice.fallback();
}

export function apiPortFile(userData: string): string {
  return path.join(userData, 'api-port.json');
}

export async function readApiPort(file: string): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { port?: unknown };
    return isStablePort(parsed.port) ? parsed.port : null;
  } catch {
    return null;
  }
}

export async function saveApiPort(file: string, port: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify({ port }, null, 2)}\n`, { mode: 0o600 });
  await rename(partial, file);
}
