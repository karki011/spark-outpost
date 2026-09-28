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
  expect(server.start).toHaveBeenCalledOnce();
  expect(server.stop).toHaveBeenCalledOnce();
});
