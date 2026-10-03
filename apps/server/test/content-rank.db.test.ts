import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner, type CodeScanner } from '../src/codescan/scanner.ts';
import { DIFFS_OFF } from '../src/orchestration/observe.ts';
import { routingLabels } from '../src/persistence/routing-labels.ts';
import { updateProfile } from '../src/persistence/setup.ts';
import { CONTENT_RANK } from '../src/routing/file-evidence.ts';
import { toLabel } from '../src/routing/labels.ts';
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
} from './orchestration-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const TOKEN = `ghp_${'d4'.repeat(18)}`;

let t: TestDb;
let root: string;
let harness: Harness | null = null;
let scanner: CodeScanner;

beforeEach(async () => {
  t = await createTestDb();
  root = await gitRepo();
  await writeFile(
    join(root, 'divider.ts'),
    `export function dayDivider(at: number) {\n  const key = "${TOKEN}";\n  return at + key.length;\n}\n`,
  );
  await writeFile(
    join(root, 'midnight.ts'),
    "import { dayDivider } from './divider';\nexport const midnight = dayDivider(0);\n",
  );
  await writeFile(join(root, '.env'), 'DIVIDER=dayDivider midnight\n');
  await writeFile(join(root, '.sparkignore'), 'private/\n');
  await mkdir(join(root, 'private'));
  await writeFile(
    join(root, 'private', 'divider-notes.ts'),
    'export const dividerNotes = "the divider shows midnight wrong";\n',
  );
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

interface EvidenceBody {
  state: { request: string; code_evidence: string };
  questions: Record<string, { instructions: { file: string } }>;
}

type EvidenceReply = (body: EvidenceBody, init?: RequestInit) => Promise<Response>;

interface Fake {
  fetch: typeof fetch;
  script: JevScript;
  evidence: EvidenceBody[];
}

const byFile =
  (nouls: Record<string, number>): EvidenceReply =>
  async (body) =>
    new Response(
      JSON.stringify({
        model: 'jev-test',
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([key, question]) => [
            key,
            { type: 'noul', noul: nouls[question.instructions.file] ?? 0.05 },
          ]),
        ),
        usage: { input_tokens: 700, output_tokens: 0 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

const broken: EvidenceReply = async () => new Response('down', { status: 503 });

const silent: EvidenceReply = (_body, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

function fakeJev(reply: EvidenceReply): Fake {
  const script: JevScript = { calls: [], scenario: NORMAL, choices: { likely_file: 'divider.ts' } };
  const others = jevFetch(script);
  const evidence: EvidenceBody[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as EvidenceBody;
    if (!('evidence_1' in body.questions)) return others(input, init);
    evidence.push(body);
    return reply(body, init);
  };
  return { fetch: fetcher, script, evidence };
}

interface ContentRow {
  jev_status: string;
  jev_input_tokens: number | null;
  policy_version: string | null;
  body: {
    summary: string;
    latencyMs: number | null;
    state: unknown;
    answer: {
      observation: boolean;
      promoted: boolean;
      skipped: string | null;
      sent: string[];
      cached?: string[];
      order: string[] | null;
      batches?: { status: string; sent: boolean; tokens: number | null }[];
    };
  };
}

async function contentRows(runId: string): Promise<ContentRow[]> {
  const { rows } = await t.db.query<ContentRow>(
    `SELECT jev_status, jev_input_tokens, policy_version, body FROM run_advice
     WHERE run_id = $1 AND purpose = 'rank_content'`,
    [runId],
  );
  return rows;
}

async function build(fetcher: typeof fetch | null) {
  harness ??= startOrchestrator(t, fetcher, { codeScan: scanner });
  const { conversationId, runId } = await startScenario(t, root, NORMAL, 'full-auto', 'auto');
  const { orchestration, asked } = await driveToEnd(t, conversationId, runId);
  expect(orchestration.status).toBe('succeeded');
  const builder = (await children(t, runId)).find((child) => child.role === 'builder')!;
  const [row] = await contentRows(runId);
  return {
    prompt: builder.prompt,
    runId,
    cards: asked.map((approval) => approval.kind),
    row: row!,
  };
}

async function runErrors(runId: string): Promise<number> {
  const { rows } = await t.db.query<{ errors: number }>(
    `SELECT count(*)::int AS errors FROM run_events WHERE run_id = $1 AND type = 'RUN_ERROR'`,
    [runId],
  );
  return rows[0]!.errors;
}

describe('content-based file ranking, observed only', { timeout: 120_000 }, () => {
  it('sends redacted previews of readable files only and records the ranking next to the current one', async () => {
    const jev = fakeJev(byFile({ 'midnight.ts': 0.95, 'divider.ts': 0.1 }));
    const { prompt, runId, row } = await build(jev.fetch);

    expect(jev.evidence).toHaveLength(1);
    const [sent] = jev.evidence;
    expect(Object.keys(sent!.state)).toEqual(['request', 'code_evidence']);
    expect(sent!.state.code_evidence).toContain('--- file: divider.ts ---');
    expect(sent!.state.code_evidence).toContain('1: export function dayDivider(at: number) {');
    expect(sent!.state.code_evidence).toContain('--- file: midnight.ts ---');
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain(TOKEN);
    expect(wire).not.toContain('.env');
    expect(wire).not.toContain('DIVIDER=');
    expect(wire).not.toContain('private/');
    expect(wire).not.toContain('dividerNotes');
    expect(wire).not.toContain('.sparkignore');

    expect(row).toMatchObject({
      jev_status: 'answered',
      jev_input_tokens: 700,
      policy_version: CONTENT_RANK.policy,
    });
    expect(row.body.answer).toMatchObject({ observation: true, promoted: false, skipped: null });
    expect(row.body.answer.order?.slice(0, 2)).toEqual(['midnight.ts', 'divider.ts']);
    expect(row.body.answer.sent).toEqual(expect.arrayContaining(['divider.ts', 'midnight.ts']));
    expect(row.body.answer.batches).toEqual([
      expect.objectContaining({ status: 'answered', sent: true, tokens: 700 }),
    ]);
    expect(JSON.stringify(row.body.state)).not.toContain(TOKEN);

    expect(prompt).toMatch(/1\. divider\.ts \|[^\n]*\| Jev 0\.80/);
    expect(prompt).not.toContain('Jev 0.95');

    await t.db.query(
      `INSERT INTO task_outcomes (run_id, kept) VALUES ($1, $2)
       ON CONFLICT (run_id) DO UPDATE SET kept = EXCLUDED.kept`,
      [runId, JSON.stringify({ files: [{ path: 'midnight.ts' }] })],
    );
    const [label] = (await routingLabels(t.db, { runIds: [runId] })).map(toLabel);
    expect(label?.contentFiles?.slice(0, 2)).toEqual(['midnight.ts', 'divider.ts']);
    expect(label?.predictedFiles[0]).toBe('divider.ts');
    expect(label?.contentRank).toMatchObject({ status: 'answered', tokens: 700, filesCached: 0 });
    expect(label?.changedFiles).toEqual(['midnight.ts']);
    expect(label?.files?.predicted).toMatchObject({ hits: 1, recall: 1 });
    expect(label?.files?.content).toMatchObject({ hits: 1, recall: 1 });
  });

  it('sends nothing while "Check changes with Jev" is off', async () => {
    await updateProfile(t.db, t.workspaceId, { jevDiffs: false });
    const jev = fakeJev(byFile({}));
    const { prompt, row, cards, runId } = await build(jev.fetch);
    expect(jev.evidence).toEqual([]);
    for (const call of jev.script.calls) {
      expect(JSON.stringify(call.state)).not.toContain('export function dayDivider');
    }
    expect(row).toMatchObject({ jev_status: 'not_asked', jev_input_tokens: null });
    expect(row.body.answer).toMatchObject({ skipped: DIFFS_OFF, sent: [], order: null });
    expect(row.body.state).toBeNull();
    expect(prompt).toMatch(/1\. divider\.ts \|[^\n]*\| Jev 0\.80/);
    expect(cards).toEqual([]);
    expect(await runErrors(runId)).toBe(0);
  });

  it('records a skipped row and nothing else when Jev is not connected', async () => {
    const { prompt, row, cards, runId } = await build(null);
    expect(row).toMatchObject({ jev_status: 'not_connected' });
    expect(row.body.answer).toMatchObject({ skipped: 'Jev not connected', sent: [] });
    expect(row.body.state).toBeNull();
    expect(prompt).toMatch(/\d\. divider\.ts \|/);
    expect(cards).toEqual([]);
    expect(await runErrors(runId)).toBe(0);
  });

  it('keeps the current ranking quietly when Jev fails on the previews', async () => {
    const jev = fakeJev(broken);
    const { prompt, row, cards, runId } = await build(jev.fetch);
    expect(row).toMatchObject({ jev_status: 'failed' });
    expect(row.body.answer.order).toBeNull();
    expect(prompt).toMatch(/1\. divider\.ts \|[^\n]*\| Jev 0\.80/);
    expect(cards).toEqual([]);
    expect(await runErrors(runId)).toBe(0);
  });

  it('gives up at the deadline without holding the turn or pausing other Jev calls', async () => {
    const jev = fakeJev(silent);
    const { prompt, row, cards, runId } = await build(jev.fetch);
    expect(row).toMatchObject({ jev_status: 'timed_out' });
    expect(row.body.latencyMs).toBeLessThan(CONTENT_RANK.deadlineMs + 500);
    expect(prompt).toMatch(/1\. divider\.ts \|[^\n]*\| Jev 0\.80/);
    expect(cards).toEqual([]);
    expect(await runErrors(runId)).toBe(0);
    const { rows } = await t.db.query<{ purpose: string; jev_status: string }>(
      `SELECT purpose, jev_status FROM run_advice
       WHERE run_id = $1 AND purpose IN ('rank', 'verify', 'route_shadow')`,
      [runId],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const other of rows) expect(other.jev_status, other.purpose).toBe('answered');
  });

  it('asks again only about files it has not answered for this request', async () => {
    const jev = fakeJev(byFile({ 'midnight.ts': 0.9 }));
    const first = await build(jev.fetch);
    expect(first.row.body.answer).toMatchObject({ cached: [] });
    expect(first.row.body.answer.sent).toEqual(['divider.ts', 'midnight.ts']);

    const second = await build(jev.fetch);
    expect(jev.evidence).toHaveLength(2);
    const again = jev.evidence[1]!;
    expect(again.state.code_evidence).not.toContain('--- file: divider.ts ---');
    expect(again.state.code_evidence).not.toContain('--- file: midnight.ts ---');
    expect(second.row).toMatchObject({ jev_status: 'answered', jev_input_tokens: 700 });
    expect(second.row.body.answer.cached).toEqual(['divider.ts', 'midnight.ts']);
    expect(second.row.body.answer.sent).not.toContain('divider.ts');
    expect(second.row.body.answer.order?.[0]).toBe('midnight.ts');
    expect(second.row.body.summary).toContain('2 from the answer cache');

    const { rows } = await t.db.query<{ cached: number }>(
      'SELECT count(*)::int AS cached FROM jev_answer_cache',
    );
    expect(rows[0]!.cached).toBeGreaterThanOrEqual(3);
  });

  it('sends nothing at all when every file is already answered', async () => {
    await writeFile(join(root, '.sparkignore'), 'private/\nnotes.txt\n');
    const jev = fakeJev(byFile({ 'midnight.ts': 0.9 }));
    await build(jev.fetch);
    const second = await build(jev.fetch);
    expect(jev.evidence).toHaveLength(1);
    expect(second.row).toMatchObject({ jev_status: 'answered', jev_input_tokens: 0 });
    expect(second.row.body.answer.sent).toEqual([]);
    expect(second.row.body.answer.batches).toEqual([]);
    expect(second.row.body.answer.cached).toEqual(['divider.ts', 'midnight.ts']);
    expect(second.row.body.answer.order?.[0]).toBe('midnight.ts');
  });
});
