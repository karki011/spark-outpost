import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexProject } from '../src/codescan/indexer.ts';
import { removeProject } from '../src/projects/project-removal.ts';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { evictBeyondCap, expireIndexes } from '../src/codescan/retention.ts';
import { createCodeScanner } from '../src/codescan/scanner.ts';
import { declarationsIn } from '../src/codescan/scan-store.ts';
import { cachedFiles, projectNames } from '../src/codescan/store.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let root: string;

const FILES: Record<string, string> = {
  'package.json': '{"name":"demo"}',
  'src/chart/use-chart-data.ts':
    'export function useChartData(range: number) { return loadSeries(range); }\n',
  'src/chart/line-chart.tsx':
    'import { useChartData } from "./use-chart-data";\nexport function LineChart() { const rows = useChartData(7); return <svg>{rows}</svg>; }\n',
  'src/chart/line-chart.test.tsx': 'import { LineChart } from "./line-chart";\nLineChart();\n',
  'src/data/load-series.ts': 'export function loadSeries(days: number) { return [days]; }\n',
  'src/ui/cz-search-input.tsx': 'export function CZSearchInput() { return null; }\n',
  'src/chart/mocked.test.ts':
    "vi.mock('./use-chart-data', () => { function useChartData() { return []; } return { useChartData }; });\n",
  'node_modules/dep/index.js': 'export const hidden = 1;\n',
  'assets/logo.png': 'binary',
};

async function put(path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}

function git(...args: string[]): void {
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
}

async function files(): Promise<Record<string, { language: string; defs: string[] }>> {
  const { rows } = await t.db.query<{ path: string; language: string; defs: string[] }>(
    `SELECT f.path, f.language, ARRAY(SELECT n.name FROM code_index_names n
       WHERE n.project_id = f.project_id AND n.id = ANY(f.def_ids) ORDER BY n.name) AS defs
     FROM code_index_files f JOIN code_index_projects p ON p.id = f.project_id
     WHERE p.root_path = $1 ORDER BY f.path`,
    [root],
  );
  return Object.fromEntries(
    rows.map((row) => [row.path, { language: row.language, defs: row.defs }]),
  );
}

beforeEach(async () => {
  t = await createTestDb();
  root = await realpath(await mkdtemp(join(tmpdir(), 'spark-codescan-')));
  for (const [path, text] of Object.entries(FILES)) await put(path, text);
  await writeFile(join(root, '.gitignore'), 'node_modules\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'base');
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

describe('code index cache', () => {
  it('reads the cached files and names in pages without losing or repeating rows', async () => {
    const outcome = await indexProject(t.db, root);
    const whole = await cachedFiles(t.db, outcome.projectId);
    const paged = await cachedFiles(t.db, outcome.projectId, 3);
    expect(whole.size).toBe(8);
    expect([...paged].sort()).toEqual([...whole].sort());
    expect((await cachedFiles(t.db, outcome.projectId, 8)).size).toBe(8);
    const names = await projectNames(t.db, outcome.projectId);
    expect(names.size).toBeGreaterThan(4);
    expect([...(await projectNames(t.db, outcome.projectId, 2))].sort()).toEqual([...names].sort());
  });

  it('keeps the ids of known names when a later refresh parses one changed file', async () => {
    const first = await indexProject(t.db, root);
    const before = await projectNames(t.db, first.projectId);
    await put(
      'src/data/load-series.ts',
      'export function loadSeries(days: number) { return [days]; }\nexport function loadTotals() { return loadSeries(1); }\n',
    );
    const second = await indexProject(t.db, root);
    expect(second).toMatchObject({ rebuilt: null, parsed: 1 });
    const after = await projectNames(t.db, first.projectId);
    expect(after.get('loadSeries')).toBe(before.get('loadSeries'));
    expect(after.get('useChartData')).toBe(before.get('useChartData'));
    expect(after.has('loadTotals')).toBe(true);
    expect(new Set(after.values()).size).toBe(after.size);
  });

  it('indexes tracked files with their symbols and skips ignored, binary and dependency files', async () => {
    const outcome = await indexProject(t.db, root);
    expect(outcome).toMatchObject({ rebuilt: 'first index', parsed: 8, capped: false });
    const indexed = await files();
    expect(Object.keys(indexed)).toEqual([
      '.gitignore',
      'package.json',
      'src/chart/line-chart.test.tsx',
      'src/chart/line-chart.tsx',
      'src/chart/mocked.test.ts',
      'src/chart/use-chart-data.ts',
      'src/data/load-series.ts',
      'src/ui/cz-search-input.tsx',
    ]);
    expect(indexed['src/chart/mocked.test.ts']?.defs).toEqual([]);
    expect(indexed['src/chart/line-chart.tsx']).toEqual({ language: 'tsx', defs: ['LineChart'] });
    const { rows } = await t.db.query<{
      status: string;
      indexed_commit: string;
      row_bytes: string;
      bytes: string;
      disk: string;
    }>(
      `SELECT status, indexed_commit, row_bytes, bytes,
         pg_total_relation_size('code_index_files') + pg_total_relation_size('code_index_names')
           + pg_total_relation_size('code_index_projects') AS disk
       FROM code_index_projects WHERE root_path = $1`,
      [root],
    );
    expect(rows[0]?.status).toBe('ready');
    expect(rows[0]?.indexed_commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Number(rows[0]?.row_bytes)).toBeGreaterThan(0);
    expect(Number(rows[0]?.bytes)).toBeGreaterThan(Number(rows[0]?.row_bytes));
    expect(Math.abs(Number(rows[0]?.bytes) - Number(rows[0]?.disk))).toBeLessThan(1024);
  });

  it('re-parses only changed files on refresh and overwrites rows', async () => {
    await indexProject(t.db, root);
    await put(
      'src/data/load-series.ts',
      'export function loadSeriesRange(days: number) { return [days]; }\n',
    );
    await unlink(join(root, 'src/chart/line-chart.test.tsx'));
    await put('src/new-widget.ts', 'export class NewWidget {}\n');
    git('add', '-A');
    git('commit', '-qm', 'change');
    const later = new Date(Date.now() + 60_000);
    await utimes(join(root, 'package.json'), later, later);

    const outcome = await indexProject(t.db, root);

    expect(outcome).toMatchObject({ rebuilt: null, parsed: 2, unchanged: 1, removed: 1 });
    const indexed = await files();
    expect(indexed['src/data/load-series.ts']?.defs).toEqual(['loadSeriesRange']);
    expect(indexed['src/new-widget.ts']?.defs).toEqual(['NewWidget']);
    expect(indexed['src/chart/line-chart.test.tsx']).toBeUndefined();
    const { rows } = await t.db.query<{ files: number; orphans: number }>(
      `SELECT (SELECT count(*)::int FROM code_index_files
                WHERE path = 'src/data/load-series.ts') AS files,
         (SELECT count(*)::int FROM code_index_names n WHERE NOT EXISTS (
            SELECT 1 FROM code_index_files f
            WHERE n.id = ANY(f.def_ids) OR n.id = ANY(f.ref_ids))) AS orphans`,
    );
    expect(rows[0]).toEqual({ files: 1, orphans: 0 });

    expect(await indexProject(t.db, root)).toMatchObject({ parsed: 0, unchanged: 0, removed: 0 });
  });

  it('rebuilds from scratch when the parser version changes or a build did not finish', async () => {
    await indexProject(t.db, root, { parserVersion: 'old-parser' });
    const upgraded = await indexProject(t.db, root);
    expect(upgraded).toMatchObject({ rebuilt: 'the parser version changed', parsed: 8 });

    await t.db.query(`UPDATE code_index_projects SET status = 'building'`);
    expect(await indexProject(t.db, root)).toMatchObject({
      rebuilt: 'an earlier build did not finish',
    });
    const { rows } = await t.db.query<{ projects: number }>(
      'SELECT count(*)::int AS projects FROM code_index_projects',
    );
    expect(rows[0]?.projects).toBe(1);
  });

  it('stores the line range of every declaration next to its name', async () => {
    await put(
      'src/data/load-series.ts',
      'export function loadSeries(days: number) {\n  return [days];\n}\n\nexport const SERIES_LIMIT = 30;\n',
    );
    await indexProject(t.db, root);
    const { rows } = await t.db.query<{ defs: number; starts: number[]; ends: number[] }>(
      `SELECT cardinality(def_ids) AS defs, def_start_lines AS starts, def_end_lines AS ends
       FROM code_index_files WHERE path = 'src/data/load-series.ts'`,
    );
    expect(rows[0]).toEqual({ defs: 2, starts: [1, 5], ends: [3, 5] });
    const found = await declarationsIn(t.db, root, ['src/data/load-series.ts', 'package.json']);
    expect(found.get('package.json')).toEqual([]);
    expect(found.get('src/data/load-series.ts')).toEqual([
      { name: 'loadSeries', kind: 'function', startLine: 1, endLine: 3, refFiles: 1 },
      { name: 'SERIES_LIMIT', kind: 'variable', startLine: 5, endLine: 5, refFiles: 0 },
    ]);
  });

  it('accepts rows written before line ranges and rebuilds them once', async () => {
    await indexProject(t.db, root, { parserVersion: 'before-ranges' });
    await t.db.query('UPDATE code_index_files SET def_start_lines = NULL, def_end_lines = NULL');
    const old = await declarationsIn(t.db, root, ['src/data/load-series.ts']);
    expect(old.get('src/data/load-series.ts')).toBeNull();

    const upgraded = await indexProject(t.db, root);
    expect(upgraded).toMatchObject({ rebuilt: 'the parser version changed', parsed: 8 });
    const { rows } = await t.db.query<{ missing: number }>(
      `SELECT count(*)::int AS missing FROM code_index_files
       WHERE def_start_lines IS NULL OR cardinality(def_start_lines) <> cardinality(def_ids)
         OR cardinality(def_end_lines) <> cardinality(def_ids)`,
    );
    expect(rows[0]?.missing).toBe(0);
    expect(await indexProject(t.db, root)).toMatchObject({ rebuilt: null, parsed: 0 });
  });

  it('ignores stored ranges that do not line up with the declarations', async () => {
    await indexProject(t.db, root);
    await t.db.query(
      `UPDATE code_index_files SET def_start_lines = '{9}', def_end_lines = '{2}'
       WHERE path = 'src/data/load-series.ts'`,
    );
    await t.db.query(
      `UPDATE code_index_files SET def_start_lines = '{1,2,3}'
       WHERE path = 'src/chart/line-chart.tsx'`,
    );
    const found = await declarationsIn(t.db, root, [
      'src/data/load-series.ts',
      'src/chart/line-chart.tsx',
    ]);
    expect(found.get('src/data/load-series.ts')).toEqual([]);
    expect(found.get('src/chart/line-chart.tsx')).toBeNull();
  });

  it('keeps only the most recently opened projects under the global cap and expires old ones', async () => {
    const other = await realpath(await mkdtemp(join(tmpdir(), 'spark-codescan-other-')));
    try {
      await writeFile(join(other, 'main.py'), 'def main():\n    return run()\n');
      const first = await indexProject(t.db, root);
      const second = await indexProject(t.db, other);
      await t.db.query(
        `UPDATE code_index_projects SET last_opened_at = now() - interval '1 hour' WHERE id = $1`,
        [second.projectId],
      );
      const { rows } = await t.db.query<{ bytes: string }>(
        'SELECT bytes FROM code_index_projects WHERE id = $1',
        [first.projectId],
      );
      const evicted = await evictBeyondCap(t.db, first.projectId, Number(rows[0]?.bytes) + 1);
      expect(evicted).toEqual([other]);

      await t.db.query(
        `UPDATE code_index_projects SET last_opened_at = now() - interval '31 days'`,
      );
      expect(await expireIndexes(t.db)).toBe(1);
      const left = await t.db.query('SELECT 1 FROM code_index_files');
      expect(left.rowCount).toBe(0);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('drops the index when its project is removed', async () => {
    await indexProject(t.db, root);
    const id = randomUUID();
    await t.db.query(
      'INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)',
      [id, t.workspaceId, 'demo', root],
    );
    await removeProject(t.db, t.workspaceId, id);
    const { rowCount } = await t.db.query('SELECT 1 FROM code_index_projects');
    expect(rowCount).toBe(0);
  });

  it('scans a request against the cache and live text search', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    await scanner.ensureIndexed(root);
    await put('src/chart/scratch.ts', 'useChartData(1);\n');

    const outcome = await scanner.scan(root, 'Add a range prop to useChartData in line-chart.tsx');

    expect(outcome.status).toBe('done');
    const report = outcome.report!;
    expect(report.index).toBe('ready');
    const top = report.candidates.slice(0, 3).map((file) => file.path);
    expect(top).toEqual(
      expect.arrayContaining(['src/chart/line-chart.tsx', 'src/chart/use-chart-data.ts']),
    );
    expect(report.candidates.find((file) => file.path === 'src/chart/scratch.ts')).toMatchObject({
      uncommitted: true,
      lines: null,
    });
    expect(report.summary.namedSymbols).toEqual([
      { name: 'useChartData', definedIn: 1, referencedBy: 2 },
    ]);
    expect(
      report.candidates.find((file) => file.path === 'src/chart/line-chart.tsx')?.hasTest,
    ).toBe(true);
  });

  it('falls back to a definition whose name ends with an undefined request name', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    await scanner.ensureIndexed(root);
    const outcome = await scanner.scan(root, 'Add a compact prop to SearchInput');
    expect(outcome.report?.summary.namedSymbols).toEqual([
      { name: 'CZSearchInput', definedIn: 1, referencedBy: 0 },
    ]);
    expect(outcome.report?.candidates[0]).toMatchObject({
      path: 'src/ui/cz-search-input.tsx',
      reasons: expect.arrayContaining(['defines a named symbol']),
    });
  });

  it('answers a scan while the index build it started is held back, then finishes it', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scanner = createCodeScanner(t.db, {
      deadlineMs: 10_000,
      scanIndexPace: () => () => held,
    });
    const during = await scanner.scan(root, 'Add a range prop to useChartData in line-chart.tsx');
    expect(during.status).toBe('done');
    expect(during.report?.index).not.toBe('ready');
    expect(during.report?.candidates.map((file) => file.path)).toContain(
      'src/chart/line-chart.tsx',
    );

    release();
    await scanner.idle();
    const after = await scanner.scan(root, 'Add a range prop to useChartData in line-chart.tsx');
    expect(after.report?.index).toBe('ready');
    expect(Object.keys(await files())).toContain('src/chart/line-chart.tsx');
  });

  it('paces a build asked for with its own pace by that pace, not the scan one', async () => {
    const used: string[] = [];
    const scanner = createCodeScanner(t.db, {
      scanIndexPace: () => () => {
        used.push('scan');
        return Promise.resolve();
      },
    });
    await scanner.ensureIndexed(root, {
      fresh: true,
      pace: () => {
        used.push('map');
        return Promise.resolve();
      },
    });
    expect(used).toEqual(['map']);
  });

  it('returns nothing useful rather than waiting past the deadline', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 1, refreshEveryMs: Infinity });
    const outcome = await scanner.scan(root, 'Rename useChartData');
    expect(['timed_out', 'partial']).toContain(outcome.status);
    expect(outcome.elapsedMs).toBeLessThan(1000);
  });
});
