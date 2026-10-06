import {
  COMMAND_CHUNK_CHARS,
  COMMAND_FINISHED,
  COMMAND_LIVE_CHARS,
  COMMAND_OUTPUT,
  COMMAND_STARTED,
  COMMAND_STORED_CHARS,
  type RunEvent,
} from '@spark-outpost/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../persistence/db.ts';
import { createCommandRecorder, cwdLabel } from './command-recorder.ts';

const SECRET = 'demo9f3k2m7x1q8z5w4c6v0b';
const ESC = '\u001b';

interface Saved {
  sql: string;
  values: unknown[];
}

function setup(reply = { shown: 'Running it now.', held: 0 }) {
  const events: { name: string; value: Record<string, unknown> }[] = [];
  const saved: Saved[] = [];
  const db = {
    query: (sql: string, values: unknown[]) => {
      saved.push({ sql, values });
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Queryable;
  let clock = Date.parse('2026-10-06T10:00:00.000Z');
  const recorder = createCommandRecorder({
    db,
    runId: 'run-1',
    append: (event: RunEvent) => {
      if (event.type === 'CUSTOM') events.push({ name: event.name, value: event.value });
      return Promise.resolve(1);
    },
    secretValues: [SECRET],
    projectRoots: ['/repo'],
    replySoFar: () => reply,
    flushMs: 5,
    now: () => clock,
  });
  const start = (id = 'c1', live = true) =>
    recorder.observe({ kind: 'command_started', id, command: 'npm test', cwd: '/repo/app', live });
  const write = (data: string, id = 'c1') => recorder.observe({ kind: 'command_output', id, data });
  const end = (failed = false, exitCode: number | null = 0, id = 'c1') =>
    recorder.observe({ kind: 'command_finished', id, failed, exitCode });
  const chunks = () => events.filter((event) => event.name === COMMAND_OUTPUT);
  const streamed = () =>
    chunks()
      .map((event) => event.value.chunk)
      .join('');
  const finalOutput = () => saved.findLast((write) => write.sql.includes('finished_at'))?.values[4];
  return {
    recorder,
    events,
    saved,
    start,
    write,
    end,
    chunks,
    streamed,
    finalOutput,
    tick: (ms: number) => (clock += ms),
  };
}

describe('command recorder', () => {
  it('records the start with a project-relative folder and where it sits in the reply', async () => {
    const t = setup({ shown: 'Running it now.', held: 3 });
    await t.start();
    expect(t.events[0]).toMatchObject({
      name: COMMAND_STARTED,
      value: {
        command: 'npm test',
        cwd: './app',
        live: true,
        startedAt: '2026-10-06T10:00:00.000Z',
        textOffset: 18,
        textBefore: 'Running it now.',
        textHeld: 3,
      },
    });
    expect(t.saved[0]!.sql).toContain('INSERT INTO run_commands');
  });

  it('numbers chunks by their position so a repeat or a gap is detectable', async () => {
    const t = setup();
    await t.start();
    await t.write('one\n');
    await vi.waitFor(() => expect(t.chunks()).toHaveLength(1));
    await t.write('two\n');
    await t.end();
    expect(t.chunks().map((event) => [event.value.at, event.value.chunk])).toEqual([
      [0, 'one\n'],
      [4, 'two\n'],
    ]);
    expect(t.events.at(-1)).toMatchObject({
      name: COMMAND_FINISHED,
      value: { status: 'completed', exitCode: 0, outputChars: 8 },
    });
    expect(t.finalOutput()).toBe('one\ntwo\n');
  });

  it('hides project secret values and secret-looking tokens before anything is stored or sent', async () => {
    const t = setup();
    await t.start();
    await t.write(`token is ${SECRET.slice(0, 10)}`);
    await t.write(`${SECRET.slice(10)}\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123\n`);
    await t.end();
    const everything = JSON.stringify([t.events, t.saved]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123');
    expect(t.streamed()).toContain('token is [redacted:secret_value]');
  });

  it('hides a secret in the command line itself', async () => {
    const t = setup();
    await t.recorder.observe({
      kind: 'command_started',
      id: 'c1',
      command: `curl -H "x-key: ${SECRET}" https://example.test`,
      cwd: null,
      live: true,
    });
    expect(JSON.stringify([t.events, t.saved])).not.toContain(SECRET);
  });

  it('strips clipboard writes, title changes and terminal queries from output', async () => {
    const t = setup();
    await t.start();
    await t.write(`${ESC}]52;c;c3Rv`);
    await t.write(`bGVu\u0007${ESC}]0;owned\u0007${ESC}[6n${ESC}[32mgreen${ESC}[0m\n`);
    await t.end();
    expect(t.streamed()).toBe(`${ESC}[32mgreen${ESC}[0m\n`);
    expect(t.finalOutput()).toBe(`${ESC}[32mgreen${ESC}[0m\n`);
  });

  it('keeps only the end of a huge output and sends that end once as a reset', async () => {
    const t = setup();
    await t.start();
    const line = `${'x'.repeat(99)}\n`;
    const block = line.repeat(1000);
    for (let sent = 0; sent < 30; sent++) await t.write(block);
    await t.end();
    const total = 30 * block.length;
    expect(total).toBeGreaterThan(COMMAND_LIVE_CHARS);
    const reset = t.chunks().at(-1)!.value;
    expect(reset.reset).toBe(true);
    expect(String(reset.chunk).length).toBeLessThanOrEqual(COMMAND_STORED_CHARS);
    expect(Number(reset.at) + String(reset.chunk).length).toBe(total);
    expect(String(t.finalOutput()).length).toBeLessThanOrEqual(COMMAND_STORED_CHARS);
    expect(t.events.at(-1)!.value.outputChars).toBe(total);
    const live = t.chunks().slice(0, -1);
    expect(live.every((event) => String(event.value.chunk).length <= COMMAND_CHUNK_CHARS)).toBe(
      true,
    );
    const liveChars = live.reduce((sum, event) => sum + String(event.value.chunk).length, 0);
    expect(liveChars).toBeLessThanOrEqual(COMMAND_LIVE_CHARS + COMMAND_CHUNK_CHARS);
  });

  it('starts over when the agent replaces the whole output', async () => {
    const t = setup();
    await t.start();
    await t.write('old\n');
    await t.recorder.observe({ kind: 'command_output', id: 'c1', data: 'new\n', replace: true });
    await t.end();
    expect(t.chunks().at(-1)!.value).toMatchObject({ at: 0, chunk: 'new\n', reset: true });
    expect(t.finalOutput()).toBe('new\n');
  });

  it('marks a failed command with its exit code', async () => {
    const t = setup();
    await t.start();
    await t.end(true, 2);
    expect(t.events.at(-1)!.value).toMatchObject({ status: 'failed', exitCode: 2 });
  });

  it('closes commands that were still running as interrupted, keeping what was captured', async () => {
    const t = setup();
    await t.start('c1');
    await t.start('c2');
    await t.write('partial\n', 'c2');
    await t.recorder.close();
    const ends = t.events.filter((event) => event.name === COMMAND_FINISHED);
    expect(ends.map((event) => event.value.status)).toEqual(['interrupted', 'interrupted']);
    expect(t.finalOutput()).toBe('partial\n');
    await t.recorder.close();
    expect(t.events.filter((event) => event.name === COMMAND_FINISHED)).toHaveLength(2);
  });

  it('keeps separate output for commands that run at the same time', async () => {
    const t = setup();
    await t.start('c1');
    await t.start('c2');
    await t.write('from one\n', 'c1');
    await t.write('from two\n', 'c2');
    await t.end(false, 0, 'c1');
    await t.end(false, 0, 'c2');
    const chunksOf = (id: unknown) =>
      t
        .chunks()
        .filter((event) => event.value.id === id)
        .map((event) => event.value.chunk);
    const [first, second] = t.events.filter((event) => event.name === COMMAND_STARTED);
    expect(chunksOf(first!.value.id)).toEqual(['from one\n']);
    expect(chunksOf(second!.value.id)).toEqual(['from two\n']);
  });

  it('ignores output and endings for commands it never saw start, and a repeated start', async () => {
    const t = setup();
    await t.write('stray');
    await t.end();
    await t.start();
    await t.start();
    expect(t.events.map((event) => event.name)).toEqual([COMMAND_STARTED]);
  });

  it('saves captured output while the command is still running', async () => {
    const t = setup();
    await t.start();
    t.tick(1500);
    await t.write('so far\n');
    await vi.waitFor(() =>
      expect(t.saved.some((write) => write.sql.includes('SET output = $2'))).toBe(true),
    );
  });
});

describe('cwdLabel', () => {
  it('shows folders relative to the project and shortens the home folder', () => {
    expect(cwdLabel('/repo', ['/repo'])).toBe('./');
    expect(cwdLabel('/repo/packages/web', ['/other', '/repo'])).toBe('./packages/web');
    expect(cwdLabel('/repository', ['/repo'])).toBe('/repository');
    expect(cwdLabel(null, ['/repo'])).toBeNull();
  });
});
