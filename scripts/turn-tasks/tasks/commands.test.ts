import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { node, processAlive } from './exec.ts';
import { taskById } from './index.ts';
import { GUIDE_SENTENCE, NOTE_FILE } from './spark-tool.ts';
import { evidenceFor, replaceIn, testBench, type TestBench } from './test-support.ts';

const SLOW = 60_000;
const TEST_PORT = 47_391;
let bench: TestBench;

beforeAll(async () => {
  bench = await testBench();
});

afterAll(async () => {
  await bench.remove();
});

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text) return text;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`${path} never appeared.`);
}

describe('the command checkers', () => {
  it(
    'task 6 wants a full-length run and its last line in the reply',
    async () => {
      const task = taskById('6');
      const repo = await bench.copy('t6');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await node(['scripts/ticker.mjs', '--seconds=1'], repo.path);
      const state = JSON.parse(await readFile(join(repo.path, '.run/ticker.json'), 'utf8'));
      expect(state.lastLine).toMatch(/^ticker finished 1\/1 token [0-9a-f]{8}$/);
      const short = await task.check(evidenceFor(repo, { reply: state.lastLine }));
      expect(short.findings.map((item) => item.pass)).toEqual([false, true]);
      const lastLine = 'ticker finished 90/90 token 0a1b2c3d';
      await writeFile(
        join(repo.path, '.run/ticker.json'),
        JSON.stringify({ seconds: 90, lastLine }),
      );
      expect((await task.check(evidenceFor(repo, { reply: `It printed: ${lastLine}` }))).pass).toBe(
        true,
      );
      expect((await task.check(evidenceFor(repo, { reply: 'tick 90 of 90' }))).pass).toBe(false);
    },
    SLOW,
  );

  it(
    'task 7 reruns the untouched script and wants it to exit 0',
    async () => {
      const task = taskById('7');
      const repo = await bench.copy('t7');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await replaceIn(repo, 'data/catalog.json', '-2400', '2400');
      await replaceIn(
        repo,
        'data/catalog.json',
        /"B-200", "name": "Linen/,
        '"E-520", "name": "Linen',
      );
      expect((await task.check(evidenceFor(repo))).pass).toBe(true);
      const cheat = await bench.copy('t7-cheat');
      await replaceIn(cheat, 'scripts/slow-check.mjs', 'process.exit(1)', 'process.exit(0)');
      expect((await task.check(evidenceFor(cheat))).pass).toBe(false);
    },
    SLOW,
  );

  it(
    'task 8 wants the title in the reply and no server left running',
    async () => {
      const task = taskById('8');
      const repo = await bench.copy('t8');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      const server = spawn(process.execPath, ['scripts/dev-server.mjs'], {
        cwd: repo.path,
        env: { ...process.env, PORT: String(TEST_PORT) },
        stdio: 'ignore',
      });
      try {
        const state = JSON.parse(await waitForFile(join(repo.path, '.run/dev-server.json')));
        const page = await (await fetch(`http://127.0.0.1:${TEST_PORT}/`)).text();
        expect(page).toContain(`<title>${state.title}</title>`);
        const running = await task.check(evidenceFor(repo, { reply: state.title }));
        expect(running.findings.map((item) => item.pass)).toEqual([true, false, false]);
        const exited = new Promise((done) => server.once('exit', done));
        server.kill('SIGTERM');
        await exited;
        expect(processAlive(state.pid)).toBe(false);
        expect((await task.check(evidenceFor(repo, { reply: state.title }))).pass).toBe(true);
        expect((await task.check(evidenceFor(repo, { reply: 'Ledger dev' }))).pass).toBe(false);
      } finally {
        server.kill('SIGKILL');
      }
    },
    SLOW,
  );

  it(
    'task 9 wants the guide sentence in the note file',
    async () => {
      const task = taskById('9');
      const repo = await bench.copy('t9');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await mkdir(join(repo.path, 'notes'));
      await writeFile(join(repo.path, NOTE_FILE), 'A listed file is hidden.\n');
      expect((await task.check(evidenceFor(repo))).pass).toBe(false);
      await writeFile(join(repo.path, NOTE_FILE), `> ${GUIDE_SENTENCE.replace(' on ', '\non ')}\n`);
      expect((await task.check(evidenceFor(repo))).pass).toBe(true);
    },
    SLOW,
  );
});
