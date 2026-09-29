import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTransaction, type Db } from './db.ts';
import { MigrationError, runMigrations } from './migrate.ts';
import { listen } from './notifications.ts';

interface FakeClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function fakeDb(failing: (sql: string) => Error | null): { db: Db; client: FakeClient } {
  const client: FakeClient = {
    query: vi.fn(async (sql: string) => {
      const error = failing(sql);
      if (error) throw error;
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { db: { connect: async () => client } as unknown as Db, client };
}

const dirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runMigrations', () => {
  it('keeps the migration error and releases a broken client when rollback and unlock fail', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrate-fail-'));
    dirs.push(dir);
    await writeFile(path.join(dir, '0001_bad.sql'), 'SELECT broken');
    const lost = new Error('connection lost');
    const { db, client } = fakeDb((sql) => {
      if (sql === 'SELECT broken') return new Error('syntax error');
      if (sql === 'ROLLBACK' || sql.includes('pg_advisory_unlock')) return lost;
      return null;
    });
    const failure = await runMigrations(db, { dir }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationError);
    expect((failure as Error).message).toBe('Migration 0001_bad.sql failed: syntax error');
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(lost);
  });

  it('releases the client normally after a clean run', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrate-ok-'));
    dirs.push(dir);
    await writeFile(path.join(dir, '0001_ok.sql'), 'SELECT 1');
    const { db, client } = fakeDb(() => null);
    expect(await runMigrations(db, { dir })).toEqual(['0001_ok.sql']);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release.mock.calls[0]?.[0]).toBeUndefined();
  });
});

describe('withTransaction', () => {
  it('throws the original error when ROLLBACK fails, and discards the client', async () => {
    const lost = new Error('connection lost');
    const { db, client } = fakeDb((sql) => (sql === 'ROLLBACK' ? lost : null));
    const original = new Error('work failed');
    await expect(
      withTransaction(db, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledWith(lost);
  });
});

describe('listen', () => {
  it('closes the client when LISTEN fails', async () => {
    vi.spyOn(pg.Client.prototype, 'connect').mockResolvedValue(undefined as never);
    vi.spyOn(pg.Client.prototype, 'query').mockRejectedValue(new Error('LISTEN failed') as never);
    const end = vi.spyOn(pg.Client.prototype, 'end').mockResolvedValue(undefined as never);
    await expect(listen('postgres://nobody@127.0.0.1:1/none', 'jobs', () => {})).rejects.toThrow(
      'LISTEN failed',
    );
    expect(end).toHaveBeenCalledOnce();
  });
});
