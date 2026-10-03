import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createCodeScanner } from '../src/codescan/scanner.ts';
import { addProject, fakeJev, mapBuilder, writeRepo } from './map-support.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

interface FoundFile {
  path: string;
  score: number;
  reasons: string[];
  area: string | null;
  kind: string | null;
  declarations: string[];
}

interface Found {
  project: string;
  status: string;
  issues: string[];
  indexedFiles: number;
  files: FoundFile[];
}

const REPO: Record<string, string> = {
  'package.json': '{ "name": "shop" }',
  '.sparkignore': 'vault/\n',
  'server/orders.ts': [
    "import { db } from './db';",
    '',
    'export function loadOrders(limit: number) {',
    '  return db.slice(0, limit);',
    '}',
    '',
    'export function cancelOrder(id: string) {',
    '  return id;',
    '}',
    '',
  ].join('\n'),
  'server/db.ts': 'export const db: string[] = [];\n',
  'server/app.ts': "import { loadOrders } from './orders';\nexport const app = loadOrders(3);\n",
  'vault/orders-key.ts': 'export function loadOrders() { return "hidden"; }\n',
  '.env': 'LOAD_ORDERS=loadOrders\n',
};

let t: TestDb;
let tools: SparkToolsHarness | null = null;
let root: string;

beforeEach(async () => {
  t = await createTestDb();
  root = await writeRepo(REPO);
  await addProject(t, root, 'shop');
});

afterEach(async () => {
  await tools?.close();
  tools = null;
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

async function find(args: Record<string, unknown>, readOnly = false) {
  const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
  tools = await startSparkTools(t, { readOnly }, { codeScan: scanner });
  const result = await tools.call('spark_find', args);
  await scanner.idle();
  return result;
}

describe('spark_find', () => {
  it('ranks files with their Map area and declarations as name@start-end', async () => {
    const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();

    const body = (await find({ query: 'Add paging to loadOrders', project: 'shop' })).json<Found>();

    expect(body).toMatchObject({ project: 'shop', status: 'complete', issues: [] });
    expect(body.indexedFiles).toBeGreaterThan(3);
    const orders = body.files[0]!;
    expect(orders.path).toBe('server/orders.ts');
    expect(orders.reasons).toContain('defines a named symbol');
    expect(orders.declarations).toEqual(['loadOrders@3-5', 'cancelOrder@7-9']);
    expect(orders.area).toEqual(expect.any(String));
    expect(orders.kind).toEqual(expect.any(String));
    expect(orders.score).toBeGreaterThan(0);
  });

  it('never lists secret or ignored files and returns no file contents', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    await scanner.ensureIndexed(root);

    const result = await find({ query: 'loadOrders', project: 'shop', limit: 40 }, true);

    const paths = result.json<Found>().files.map((file) => file.path);
    expect(paths).toContain('server/orders.ts');
    expect(paths).not.toContain('vault/orders-key.ts');
    expect(paths).not.toContain('.env');
    expect(result.text).not.toContain('hidden');
    expect(result.text).not.toContain('db.slice');
  });

  it('keeps to a folder and says so honestly when the index is not built yet', async () => {
    const body = (
      await find({ query: 'loadOrders', project: 'shop', under: './server/' })
    ).json<Found>();

    expect(body.status).toBe('index_building');
    expect(body.issues.join(' ')).toMatch(/code index/);
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files.every((file) => file.path.startsWith('server/'))).toBe(true);
    expect(body.files.every((file) => file.declarations.length === 0)).toBe(true);
  });

  it('reports partial for rows indexed before line ranges existed', async () => {
    const scanner = createCodeScanner(t.db, { deadlineMs: 10_000 });
    await scanner.ensureIndexed(root);
    await t.db.query(
      `UPDATE code_index_files SET def_start_lines = NULL, def_end_lines = NULL
       WHERE path = 'server/orders.ts'`,
    );
    tools = await startSparkTools(t, {}, { codeScan: scanner });

    const body = (
      await tools.call('spark_find', { query: 'loadOrders', project: 'shop' })
    ).json<Found>();

    expect(body).toMatchObject({ status: 'partial' });
    expect(body.issues).toContain('1 files have no declaration line ranges yet.');
    expect(body.files.find((file) => file.path === 'server/orders.ts')?.declarations).toEqual([]);
  });

  it('explains a missing project', async () => {
    const result = await find({ query: 'loadOrders', project: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No project called nope');
  });
});
