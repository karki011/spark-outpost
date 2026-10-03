import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner, type CodeScanner } from '../src/codescan/scanner.ts';
import { children } from './coordinator-support.ts';
import {
  connectProviders,
  driveToEnd,
  gitRepo,
  jevFetch,
  NORMAL,
  removeRepo,
  startOrchestrator,
  startScenario,
  type Harness,
  type JevScript,
  type Scenario,
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const RESEARCH: Scenario = {
  id: 'research',
  text: 'Investigate why the day divider jumps after midnight.',
  mode: 'do',
  destructive: 0.02,
  intent: 'research',
  intentProbabilities: { research: 0.9, bug_fix: 0.1 },
};

const HINT = 'Likely code (a ranking hint, not a limit). Code scan: complete.';
const TOKEN = `ghp_${'b2'.repeat(18)}`;

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let scanner: CodeScanner;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(
    join(root, 'store.ts'),
    `export function dayDivider(at: number) {\n  const key = "${TOKEN}";\n  return at + key.length;\n}\n`,
  );
  await writeFile(
    join(root, 'midnight.ts'),
    "import { dayDivider } from './store';\nexport const midnight = dayDivider(0);\n",
  );
  await writeFile(join(root, '.env'), 'DIVIDER=dayDivider midnight\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
  git('add', '-A', '-f');
  git('commit', '-qm', 'code');
  await connectProviders(t);
  scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
  await scanner.ensureIndexed(root);
});

afterEach(async () => {
  await harness?.stop();
  harness = null;
  await scanner.idle();
  await t.cleanup();
  await removeRepo(root);
});

afterAll(async () => {
  await stopParseWorker();
});

async function builderPrompt(fetcher: typeof fetch | null): Promise<string> {
  harness = startOrchestrator(t, fetcher, { codeScan: scanner });
  const { conversationId, runId } = await startScenario(t, root, NORMAL, 'full-auto', 'auto');
  const { orchestration } = await driveToEnd(t, conversationId, runId);
  expect(orchestration.status).toBe('succeeded');
  return (await children(t, runId)).find((child) => child.role === 'builder')!.prompt;
}

async function jevRows(): Promise<number> {
  const { rows } = await t.db.query<{ asked: number }>(
    `SELECT count(*)::int AS asked FROM run_advice WHERE jev_status = 'answered'`,
  );
  return rows[0]!.asked;
}

function expectBlock(prompt: string): void {
  expect(prompt).toContain('<code_evidence>');
  expect(prompt).toContain(HINT);
  expect(prompt).toMatch(/\d\. store\.ts \|/);
  expect(prompt).toContain('store.ts: dayDivider@1-4');
  expect(prompt).toContain('--- store.ts:1-4 (dayDivider) ---');
  expect(prompt).toContain('1: export function dayDivider(at: number) {');
  expect(prompt).not.toContain(TOKEN);
  expect(prompt).not.toMatch(/\d\. \.env/);
  expect(prompt).not.toContain('DIVIDER=');
}

describe('code context for agents', { timeout: 120_000 }, () => {
  it('gives the Builder files, declaration leads and excerpts with no Jev at all', async () => {
    const prompt = await builderPrompt(null);
    expectBlock(prompt);
    expect(prompt).not.toContain('| Jev ');
    expect(await jevRows()).toBe(0);
  });

  it('adds Jev probabilities to the same block when Jev ranks the files', async () => {
    const script: JevScript = { calls: [], scenario: NORMAL, choices: { likely_file: 'store.ts' } };
    const prompt = await builderPrompt(jevFetch(script));
    expectBlock(prompt);
    expect(prompt).toMatch(/1\. store\.ts \|[^\n]*\| Jev 0\.80/);
    const ranked = script.calls.find((call) => call.questions.includes('likely_file'))!;
    expect(JSON.stringify(ranked.state)).not.toContain('export function dayDivider');
  });

  it('still gives the block when Jev answers every call with an error', async () => {
    const failing: typeof fetch = async () =>
      new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'text/plain' } });
    const prompt = await builderPrompt(failing);
    expectBlock(prompt);
    expect(prompt).not.toContain('| Jev ');
  });

  it('still gives the block, after a bounded wait, when Jev never answers', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const started = Date.now();
    const prompt = await builderPrompt(hanging);
    expectBlock(prompt);
    expect(Date.now() - started).toBeLessThan(60_000);
  });

  it('gives the Reader the same block for a research request', async () => {
    harness = startOrchestrator(t, null, { codeScan: scanner });
    const { conversationId, runId } = await startScenario(t, root, RESEARCH, null);
    const { orchestration } = await driveToEnd(t, conversationId, runId);
    expect(orchestration.status).toBe('succeeded');
    const { rows } = await t.db.query<{ payload: string }>(
      `SELECT payload::text FROM run_protocol_log
       WHERE run_id = $1 AND method = 'session/prompt' AND direction = 'to_agent'`,
      [runId],
    );
    const prompt = (JSON.parse(`[${rows.map((row) => row.payload).join(',')}]`) as unknown[])
      .map((payload) => JSON.stringify(payload).replaceAll('\\n', '\n'))
      .join('\n');
    expect(prompt).toContain(HINT);
    expect(prompt).toContain('store.ts: dayDivider@1-4');
  });
});
