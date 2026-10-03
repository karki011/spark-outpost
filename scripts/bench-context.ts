import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { estimateTokens } from '../apps/server/src/codescan/jev-state.ts';
import { stopParseWorker } from '../apps/server/src/codescan/parse-pool.ts';
import { createCodeScanner, type ScanOutcome } from '../apps/server/src/codescan/scanner.ts';
import {
  CODE_CONTEXT,
  excerptTargets,
  renderCodeContext,
} from '../apps/server/src/find/context-block.ts';
import { readExcerpts } from '../apps/server/src/find/excerpts.ts';
import { codeLeads } from '../apps/server/src/find/leads.ts';
import { findIssues, findStatus } from '../apps/server/src/find/status.ts';
import { LIKELY_HINTS, likelyFilesLine } from '../apps/server/src/orchestration/likely-files.ts';
import type { Ranking } from '../apps/server/src/orchestration/observe-rank.ts';
import { createDb, type Db } from '../apps/server/src/persistence/db.ts';
import { runMigrations } from '../apps/server/src/persistence/migrate.ts';
import { readIgnore } from '../apps/server/src/projects/project-fs.ts';
import { atK, TOP_K } from '../apps/server/src/routing/labels.ts';
import { predictedFiles } from '../apps/server/src/routing/file-ranking.ts';
import {
  recordedTotals,
  renderContextReport,
  summarise,
  type ContextRow,
} from './bench/context-report.ts';
import { createTaskRepo } from './bench/fixture.ts';
import type { BenchRun } from './bench/results.ts';
import { TASKS, type BenchTask } from './bench/tasks.ts';
import { testDatabaseUrl } from './test-database.ts';

const { values } = parseArgs({
  options: {
    tasks: { type: 'string' },
    jev: { type: 'string', default: 'fake' },
    'recorded-line': { type: 'string' },
    'recorded-block': { type: 'string' },
    out: { type: 'string' },
  },
});

if (values.jev !== 'fake' && values.jev !== 'none') {
  throw new Error('Use --jev fake or --jev none. This script never calls a live provider.');
}

if (existsSync('.local/credentials.env')) process.loadEnvFile('.local/credentials.env');
const url = testDatabaseUrl();
const SCHEMA = 'bench_context';
const FAKE_DECAY = 0.5;

function fakeRanking(outcome: ScanOutcome): Ranking | null {
  const report = outcome.report;
  if (!report) return null;
  const predicted = predictedFiles(report.candidates.map((file) => file.path));
  const fake = values.jev === 'fake';
  return {
    files: report.candidates.slice(0, predicted.length),
    predicted,
    probabilities: new Map(
      fake ? predicted.map((path, index) => [path, FAKE_DECAY ** (index + 1)]) : [],
    ),
  };
}

function lineRow(task: BenchTask, ranking: Ranking | null): ContextRow {
  const line = likelyFilesLine(ranking);
  const files = line
    ? (ranking?.predicted ?? [])
        .filter((path) => ranking?.probabilities.has(path))
        .slice(0, LIKELY_HINTS)
    : [];
  return {
    task: task.id,
    variant: 'line',
    hintTokens: line ? estimateTokens(line) : null,
    files: files.length,
    leadFiles: 0,
    excerpts: 0,
    filesAtK: atK(files, task.allowed),
  };
}

async function blockRow(
  db: Db,
  task: BenchTask,
  root: string,
  outcome: ScanOutcome,
  ranking: Ranking | null,
): Promise<ContextRow> {
  const empty: ContextRow = {
    task: task.id,
    variant: 'block',
    hintTokens: null,
    files: 0,
    leadFiles: 0,
    excerpts: 0,
    filesAtK: atK([], task.allowed),
  };
  if (!outcome.report) return empty;
  const ignore = await readIgnore(root);
  const found = await codeLeads(db, root, outcome.report, {
    ignore,
    limit: CODE_CONTEXT.files,
    declarations: CODE_CONTEXT.declarationsPerFile,
    order: ranking?.predicted,
  });
  const rendered = renderCodeContext({
    status: findStatus(outcome, found),
    issues: findIssues(outcome, found),
    leads: found.leads,
    ...(ranking ? { probabilities: ranking.probabilities } : {}),
    excerpts: await readExcerpts(root, excerptTargets(found.leads), ignore),
  });
  if (!rendered) return empty;
  const files = found.leads.slice(0, rendered.files).map((lead) => lead.path);
  return {
    ...empty,
    hintTokens: rendered.tokens,
    files: rendered.files,
    leadFiles: rendered.leadFiles,
    excerpts: rendered.excerpts,
    filesAtK: atK(files, task.allowed),
  };
}

async function recorded(path: string | undefined) {
  if (!path) return recordedTotals(null);
  return recordedTotals(JSON.parse(await readFile(path, 'utf8')) as BenchRun);
}

const wanted = values.tasks ? new Set(values.tasks.split(',')) : null;
const tasks = TASKS.filter((task) => !wanted || wanted.has(task.id));
const admin = createDb(url, { max: 1 });
await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
await admin.query(`CREATE SCHEMA ${SCHEMA}`);
const db = createDb(url, { searchPath: SCHEMA, max: 4 });
const scratch = await mkdtemp(join(tmpdir(), 'spark-bench-context-'));
const rows: ContextRow[] = [];
try {
  await runMigrations(db);
  const scanner = createCodeScanner(db, { deadlineMs: 10_000 });
  for (const task of tasks) {
    const repo = await createTaskRepo(task, join(scratch, task.id));
    await scanner.ensureIndexed(repo.path, { fresh: true });
    const outcome = await scanner.scan(repo.path, task.prompt);
    await scanner.idle();
    const ranking = fakeRanking(outcome);
    rows.push(lineRow(task, ranking), await blockRow(db, task, repo.path, outcome, ranking));
  }
  const summaries = summarise(rows, {
    line: await recorded(values['recorded-line']),
    block: await recorded(values['recorded-block']),
  });
  const report = renderContextReport(rows, summaries, TOP_K);
  if (values.out) await writeFile(values.out, report);
  else process.stdout.write(report);
} finally {
  await stopParseWorker();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
  await rm(scratch, { recursive: true, force: true });
}
