import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../persistence/db.ts';
import { MOD_STARTUP_MS, managedBlock, modHealth, readManagedSettings } from './mod-health.ts';
import type { LiveSession } from './native-runtime-types.ts';

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

function session(provider = 'claude', args = ['--plugin-dir', '/data/mod']): LiveSession {
  return {
    row: { id: 's1', conversation_id: 'c1', generation: 3, provider },
    launch: { command: '/usr/local/bin/claude', args },
  } as unknown as LiveSession;
}

function setup(options: { managed?: unknown[]; checkFails?: boolean } = {}) {
  const writes: [string, string | null][] = [];
  const timers = new Map<number, () => void>();
  let next = 0;
  const db = {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('mod_state')) writes.push([values[2] as string, values[3] as string | null]);
      return { rows: [{ conversation_id: 'c1' }] };
    },
  } as unknown as Db;
  const checked: string[] = [];
  const health = modHealth({
    db,
    managed: async () => options.managed ?? [],
    checkFails: async (command, directory) => {
      checked.push(`${command} ${directory}`);
      return options.checkFails ?? false;
    },
    setTimer: (run, ms) => {
      expect(ms).toBe(MOD_STARTUP_MS);
      timers.set(++next, run);
      return next;
    },
    clearTimer: (timer) => timers.delete(timer as number),
  });
  const expire = async () => {
    for (const run of [...timers.values()]) run();
    timers.clear();
    await new Promise((done) => setTimeout(done, 0));
  };
  return { health, writes, timers, checked, expire };
}

describe('noticing when Spark’s mod did not load', () => {
  it('records that it loaded on its first check-in, and only once', async () => {
    const { health, writes, timers } = setup();
    health.ready(session());
    health.checkedIn(session());
    health.checkedIn(session());
    await new Promise((done) => setTimeout(done, 0));
    expect(writes).toEqual([['loaded', null]]);
    expect(timers.size).toBe(0);
  });

  it('records a missing mod when nothing checks in within the window after the session starts', async () => {
    const { health, writes, checked, expire } = setup();
    health.ready(session());
    health.ready(session());
    await expire();
    expect(writes).toEqual([
      ['missing', 'it didn’t check in within 15 seconds of the session starting'],
    ]);
    expect(checked).toEqual(['/usr/local/bin/claude /data/mod']);
  });

  it('says Claude Code rejected the mod when its plugin check fails', async () => {
    const { health, writes, expire } = setup({ checkFails: true });
    health.ready(session());
    await expire();
    expect(writes).toEqual([['missing', 'Claude Code’s plugin check rejected it']]);
  });

  it('names an organization setting that keeps the mod out, at launch', async () => {
    const { health, writes } = setup({ managed: [null, { allowManagedModsOnly: true }] });
    await health.launched(session());
    expect(writes).toEqual([
      ['missing', 'your organization allows only its own mods in Claude Code'],
    ]);
  });

  it('turns a late check-in into loaded', async () => {
    const { health, writes, expire } = setup();
    health.ready(session());
    await expire();
    health.checkedIn(session());
    await new Promise((done) => setTimeout(done, 0));
    expect(writes.map(([state]) => state)).toEqual(['missing', 'loaded']);
  });

  it('starts no window for Codex, an old Claude without mods, or after the session ended', async () => {
    const { health, writes, timers } = setup({ managed: [{ disableAllHooks: true }] });
    health.ready(session('codex'));
    health.ready(session('claude', []));
    await health.launched(session('claude', []));
    expect(timers.size).toBe(0);
    health.ready(session());
    health.ended('c1');
    expect(timers.size).toBe(0);
    health.ready(session());
    health.dispose();
    expect([timers.size, writes]).toEqual([0, []]);
  });
});

describe('reading the organization’s Claude Code settings', () => {
  it('reads managed-settings.json and its drop-ins, skipping files that do not parse', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'spark-managed-'));
    folders.push(folder);
    await mkdir(join(folder, 'managed-settings.d'));
    await writeFile(join(folder, 'managed-settings.json'), '{"model":"x"}');
    await writeFile(
      join(folder, 'managed-settings.d', '10-hooks.json'),
      '{"allowManagedHooksOnly":true}',
    );
    await writeFile(join(folder, 'managed-settings.d', 'broken.json'), '{');
    await writeFile(join(folder, 'managed-settings.d', 'notes.txt'), '{"disableAllHooks":true}');
    const settings = await readManagedSettings(folder);
    expect(managedBlock(settings)).toBe(
      'your organization allows only its own hooks in Claude Code',
    );
    expect(managedBlock(await readManagedSettings(join(folder, 'missing')))).toBeNull();
  });
});
