import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { AreaNoteError, readAreaNote, saveAreaNote } from '../src/map/area-notes.ts';
import { projectMap } from '../src/map/read-store.ts';
import { addProject, fakeJev, git, mapBuilder, writeFiles, writeRepo } from './map-support.ts';
import { startSparkTools, type SparkToolsHarness } from './spark-mcp-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const FILES: Record<string, string> = {
  'package.json': '{ "name": "shop" }',
  'server/app.ts': "import { orders } from './orders';\nexport const app = orders;\n",
  'server/orders.ts':
    "import { db } from '../store/db';\nexport function listOrders() {\n  return db;\n}\nexport const orders = listOrders;\n",
  'store/db.ts': 'export const db = 1;\n',
  'store/.env': 'TOKEN=abc\n',
};

let t: TestDb;
let root: string;
let projectId: string;
let tools: SparkToolsHarness | null = null;

async function build() {
  const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
  expect(await builder.runOnce()).toBe(true);
  await scanner.idle();
}

async function areaHolding(path: string) {
  const { rows } = await t.db.query<{ area_id: string }>(
    `SELECT m.area_id FROM map_files m JOIN map_repos r ON r.id = m.repo_id
     WHERE r.root_path = $1 AND m.path = $2`,
    [root, path],
  );
  return rows[0]!.area_id;
}

function note(areaId: string, sources: { path: string; startLine: number; endLine: number }[]) {
  return {
    root,
    areaId,
    text: 'Lists orders from the store.',
    sources,
    ignore: [],
    conversationId: null,
  };
}

beforeEach(async () => {
  t = await createTestDb();
  root = await writeRepo(FILES);
  projectId = await addProject(t, root, 'shop');
  await build();
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

describe('area explanations', () => {
  it('saves an explanation and marks it out of date when a cited file changes', async () => {
    const areaId = await areaHolding('server/orders.ts');
    await saveAreaNote(
      t.db,
      note(areaId, [{ path: './server/orders.ts', startLine: 2, endLine: 4 }]),
    );

    const fresh = await readAreaNote(t.db, root, areaId);
    await writeFiles(root, { 'server/orders.ts': 'export const orders = 2;\n' });
    git(root, 'commit', '-qam', 'change orders');
    await build();
    const later = await readAreaNote(t.db, root, areaId);

    expect(fresh).toMatchObject({
      text: 'Lists orders from the store.',
      sources: [{ path: 'server/orders.ts', startLine: 2, endLine: 4 }],
      changedSince: [],
    });
    expect(later?.changedSince).toEqual(['server/orders.ts']);
  });

  it('replaces the earlier explanation for the same area', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const source = [{ path: 'server/orders.ts', startLine: 1, endLine: 1 }];
    await saveAreaNote(t.db, note(areaId, source));
    await saveAreaNote(t.db, { ...note(areaId, source), text: 'Second version.' });

    expect((await readAreaNote(t.db, root, areaId))?.text).toBe('Second version.');
  });

  it('refuses sources off the map, outside the file, secret, or all from other areas', async () => {
    const areaId = await areaHolding('server/orders.ts');
    const save = (sources: { path: string; startLine: number; endLine: number }[]) =>
      saveAreaNote(t.db, note(areaId, sources));

    await expect(save([{ path: 'nope.ts', startLine: 1, endLine: 1 }])).rejects.toThrow(
      AreaNoteError,
    );
    await expect(save([{ path: 'server/orders.ts', startLine: 4, endLine: 99 }])).rejects.toThrow(
      /outside it/,
    );
    await expect(save([{ path: 'store/.env', startLine: 1, endLine: 1 }])).rejects.toThrow(
      /secret file/,
    );
    await expect(save([{ path: 'store/db.ts', startLine: 1, endLine: 1 }])).rejects.toThrow(
      /from this area/,
    );
    expect(await readAreaNote(t.db, root, areaId)).toBeNull();
  });
});

describe('spark_map with an area', () => {
  it("returns the area's entry points, related areas and saved explanation", async () => {
    const areaId = await areaHolding('server/orders.ts');
    const storeId = await areaHolding('store/db.ts');
    const built = await projectMap(t.db, projectId, root);
    const names = new Map(built.areas.map((area) => [area.id, area.name]));
    await saveAreaNote(
      t.db,
      note(areaId, [{ path: 'server/orders.ts', startLine: 2, endLine: 4 }]),
    );
    tools = await startSparkTools(t, { conversationId: null });

    const page = (await tools.call('spark_map', { project: 'shop', area: areaId })).json<{
      area: { id: string };
      entryPoints: { name: string; file: string; lines: string }[];
      dependsOn: { name: string }[];
      explanation: { text: string; sources: string[]; outOfDate?: string };
    }>();
    const bare = (await tools.call('spark_map', { project: 'shop', area: storeId })).json<{
      usedBy: { name: string }[];
      explanation: string;
    }>();
    const missing = await tools.call('spark_map', { project: 'shop', area: 'no such area' });

    expect(page.area.id).toBe(areaId);
    expect(page.entryPoints).toContainEqual(
      expect.objectContaining({ name: 'listOrders', file: 'server/orders.ts', lines: '2-4' }),
    );
    expect(page.dependsOn.map((area) => area.name)).toEqual([names.get(storeId)]);
    expect(page.explanation).toMatchObject({
      text: 'Lists orders from the store.',
      sources: ['server/orders.ts 2-4'],
    });
    expect(page.explanation.outOfDate).toBeUndefined();
    expect(bare.usedBy.map((area) => area.name)).toEqual([names.get(areaId)]);
    expect(bare.explanation).toContain('spark_map_note');
    expect(missing.text).toContain('no area called no such area');
  });
});
