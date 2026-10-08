import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SystemOneRequest } from '../../apps/server/src/advisor/jev.ts';
import { stopParseWorker } from '../../apps/server/src/codescan/parse-pool.ts';
import type { ScanReport } from '../../apps/server/src/codescan/scan.ts';
import { declarationsIn } from '../../apps/server/src/codescan/scan-store.ts';
import { createCodeScanner } from '../../apps/server/src/codescan/scanner.ts';
import { readSource } from '../../apps/server/src/find/excerpts.ts';
import { sendable } from '../../apps/server/src/map/label-evidence.ts';
import { createMapBuilder } from '../../apps/server/src/map/scheduler.ts';
import { ensureLocalWorkspace } from '../../apps/server/src/persistence/conversations.ts';
import { createDb, type Db } from '../../apps/server/src/persistence/db.ts';
import { runMigrations } from '../../apps/server/src/persistence/migrate.ts';
import { readIgnore } from '../../apps/server/src/projects/project-fs.ts';
import {
  CONTENT_RANK,
  evidenceBatches,
  previewOf,
  type FilePreview,
} from '../../apps/server/src/routing/file-evidence.ts';
import { rankQuestions } from '../../apps/server/src/routing/file-ranking.ts';
import { keychainSecretStore } from '../../apps/server/src/setup/secrets.ts';
import { testDatabaseUrl } from '../test-database.ts';
import { requestHash, type Item } from './versus-items.ts';
import type { ResultRow } from './versus-run.ts';

const SCHEMA = 'bench_jev_versus';
const IGNORE_FILE = '.sparkignore';
const JEV_USD_PER_TOKEN = 0.042 / 1_000_000;

export interface Captured {
  items: Item[];
  jevRows: ResultRow[];
  mapTimings: unknown;
}

async function freshDb(url: string): Promise<Db> {
  const admin = createDb(url, { max: 1 });
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  const db = createDb(url, { searchPath: SCHEMA, max: 6 });
  await runMigrations(db);
  return db;
}

interface SystemOneBody extends SystemOneRequest {
  model: string;
}

function recordingFetch(captured: Captured): typeof fetch {
  return async (input, init) => {
    const startedAt = Date.now();
    const response = await fetch(input, init);
    if (!String(input).endsWith('/v1/systemone') || typeof init?.body !== 'string') return response;
    const body = JSON.parse(init.body) as SystemOneBody;
    const request = { state: body.state, questions: body.questions };
    const use = 'route' in request.questions ? 'map_link' : 'map_label';
    const id = `${use}:${requestHash(request)}`;
    const answered = response.ok
      ? ((await response.clone().json()) as {
          answers: Record<string, unknown>;
          usage?: { input_tokens: number };
        })
      : null;
    const tokens = answered?.usage?.input_tokens ?? null;
    captured.items.push({ id, use, source: 'map build of this repository', request, truth: {} });
    captured.jevRows.push({
      item: id,
      variant: 'jev',
      key: null,
      ok: answered !== null,
      failure: answered ? null : `status ${response.status}`,
      wallMs: Date.now() - startedAt,
      apiMs: null,
      inputTokens: tokens,
      outputTokens: 0,
      costUsd: tokens === null ? null : tokens * JEV_USD_PER_TOKEN,
      cliCostUsd: null,
      answers: answered?.answers ?? null,
    });
    return response;
  };
}

interface Commit {
  subject: string;
  files: string[];
}

function recentCommits(root: string, limit: number): Commit[] {
  const log = execFileSync(
    'git',
    ['-C', root, 'log', '--no-merges', '-n', '400', '--name-only', '--format=%x00%s'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return log
    .split('\u0000')
    .map((entry) => entry.trim().split('\n').filter(Boolean))
    .map(([subject, ...files]) => ({ subject: subject ?? '', files }))
    .filter(
      (commit) =>
        commit.subject.length >= 30 &&
        commit.files.length >= 1 &&
        commit.files.length <= 8 &&
        commit.files.every((file) => existsSync(join(root, file))),
    )
    .slice(0, limit);
}

async function previews(db: Db, root: string, report: ScanReport) {
  const ignore = await readIgnore(root);
  const kept = report.candidates
    .map((file) => file.path)
    .filter((path) => sendable(path, ignore) && basename(path) !== IGNORE_FILE)
    .slice(0, CONTENT_RANK.files);
  const declared = await declarationsIn(db, root, kept);
  const found: FilePreview[] = [];
  for (const path of kept) {
    const source = await readSource(root, path);
    const preview =
      source === null ? null : previewOf(path, source, declared.get(path) ?? null, report);
    if (preview) found.push(preview);
  }
  return found;
}

async function rankItems(db: Db, root: string, limit: number): Promise<Item[]> {
  const scanner = createCodeScanner(db, { deadlineMs: 20_000 });
  await scanner.ensureIndexed(root);
  const items: Item[] = [];
  for (const commit of recentCommits(root, limit)) {
    const outcome = await scanner.scan(root, commit.subject);
    const report = outcome.report;
    if (!report || report.candidates.length < 2) continue;
    const source = 'code scan of this repository for a commit subject';
    const rank = rankQuestions(commit.subject, report);
    items.push({
      id: `rank:${requestHash(rank)}`,
      use: 'rank',
      source,
      request: rank,
      truth: {},
      relevant: commit.files,
    });
    const shown = await previews(db, root, report);
    for (const batch of evidenceBatches(commit.subject, shown).batches) {
      items.push({
        id: `rank_content:${requestHash(batch.asked)}`,
        use: 'rank_content',
        source,
        request: batch.asked,
        truth: Object.fromEntries(
          batch.paths.map((path, index) => [
            `evidence_${index + 1}`,
            String(commit.files.includes(path)),
          ]),
        ),
      });
    }
  }
  await scanner.idle();
  return items;
}

export async function capture(root: string, rankLimit: number, budget: number): Promise<Captured> {
  const captured: Captured = { items: [], jevRows: [], mapTimings: null };
  const db = await freshDb(testDatabaseUrl());
  try {
    const workspaceId = await ensureLocalWorkspace(db);
    await db.query(
      `INSERT INTO advisor_connections (workspace_id, advisor, method, detail, verified_at)
       VALUES ($1, 'jev', 'api_key', 'bench', now())`,
      [workspaceId],
    );
    await db.query(
      'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
      [randomUUID(), workspaceId, 'versus', root],
    );
    const builder = createMapBuilder({
      db,
      scanner: createCodeScanner(db),
      jev: {
        db,
        secrets: keychainSecretStore(),
        fetch: recordingFetch(captured),
        baseUrl: process.env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai',
      },
      budget,
      pollMs: 200,
    });
    await builder.runOnce();
    const { rows } = await db.query(
      'SELECT status, file_count, area_count, edge_count, timings FROM map_repos WHERE root_path = $1',
      [root],
    );
    captured.mapTimings = rows[0] ?? null;
    captured.items.push(...(await rankItems(db, root, rankLimit)));
  } finally {
    await stopParseWorker();
    await db.end();
  }
  return captured;
}
