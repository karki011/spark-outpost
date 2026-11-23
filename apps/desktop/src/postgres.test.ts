import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startDatabase } from './postgres.ts';

const server = vi.hoisted(() => ({
  initialise: vi.fn(() => Promise.resolve()),
  start: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
}));

vi.mock('embedded-postgres', () => ({
  default: vi.fn(function EmbeddedPostgres() {
    return server;
  }),
}));

const pgCtl = vi.hoisted(() => {
  const stop = vi.fn(() => Promise.resolve());
  return { stop, start: vi.fn(() => Promise.resolve(stop)) };
});

vi.mock('./postgres-windows.ts', () => ({
  startWithPgCtl: pgCtl.start,
  stopLeftoverWithPgCtl: vi.fn(() => Promise.resolve()),
}));

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function Client() {
      return {
        connect: () => Promise.reject(new Error('password authentication failed')),
        end: () => Promise.resolve(),
      };
    }),
  },
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'desktop-postgres-'));
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(dir, { recursive: true, force: true });
});

it('stops the embedded Postgres it started when the database cannot be created', async () => {
  const starting = startDatabase({
    dataDir: path.join(dir, 'data'),
    passwordFile: path.join(dir, 'secrets', 'postgres-password'),
    port: 54_400,
    log: () => {},
  });

  await expect(starting).rejects.toThrow('password authentication failed');
  const started = process.platform === 'win32' ? pgCtl : server;
  expect(started.start).toHaveBeenCalledOnce();
  expect(started.stop).toHaveBeenCalledOnce();
});
