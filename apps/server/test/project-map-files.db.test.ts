import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MapArea, MapFile } from '@spark-outpost/contracts';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { coreImpact } from '../src/map/impact.ts';
import { createTestApp, localClient } from './app-support.ts';
import { addProject, fakeJev, mapBuilder, writeFiles, writeRepo } from './map-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const FILES: Record<string, string> = {
  'package.json': '{ "name": "shop" }',
  'server/app.ts':
    "import express from 'express';\nimport { orders } from './orders';\nconst app = express();\napp.use('/api', orders);\nexport { app };\n",
  'server/orders.ts':
    "import { Router } from 'express';\nimport { db } from './store/db';\nexport const orders = Router();\norders.get('/orders/:id', (req, res) => res.json(db));\n",
  'server/store/db.ts': "import pg from 'pg';\nexport const db = new pg.Pool();\n",
  'server/store/orders.ts': "import { db } from './db';\nexport const all = () => db;\n",
  'server/store/users.ts': "import { db } from './db';\nexport const users = () => db;\n",
  'server/store/db.test.ts': "import { db } from './db';\ntest('db', () => db);\n",
  'web/Orders.tsx':
    "import { useState } from 'react';\nexport function Orders() { useState(0); return <p />; }\n",
  'web/format.ts': 'export const show = (v: number) => v.toFixed(2);\n',
  'docs/guide.md': '# Guide\n',
};

let t: TestDb;
let root: string;
let projectId: string;

function commitAs(email: string, message: string): void {
  execFileSync('git', [
    '-C',
    root,
    '-c',
    `user.email=${email}`,
    '-c',
    'user.name=Someone',
    'commit',
    '-qam',
    message,
  ]);
}

beforeEach(async () => {
  t = await createTestDb();
  root = await writeRepo(FILES);
  await writeFiles(root, { 'server/store/db.ts': "import pg from 'pg';\nexport const db = 1;\n" });
  commitAs('ada@example.com', 'db tweak');
  projectId = await addProject(t, root);
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

async function built() {
  const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
  expect(await builder.runOnce()).toBe(true);
  await scanner.idle();
  const api = localClient(createTestApp(t));
  const map = (await api.get(`/api/projects/${projectId}/map`)).body as { areas: MapArea[] };
  const files: MapFile[] = [];
  for (const area of map.areas) {
    const detail = await api.get(`/api/projects/${projectId}/map/areas/${area.id}`);
    files.push(...(detail.body.files as MapFile[]));
  }
  return { api, areas: map.areas, files: new Map(files.map((file) => [file.path, file])) };
}

describe('map file facts', () => {
  it('stores a kind, last change, change count and author count per file, and kind counts per area', async () => {
    const { areas, files } = await built();
    expect(
      Object.fromEntries([...files.values()].map((file) => [file.path, file.kind])),
    ).toMatchObject({
      'server/app.ts': 'api',
      'server/orders.ts': 'api',
      'server/store/db.ts': 'data',
      'server/store/db.test.ts': 'test',
      'web/Orders.tsx': 'ui',
      'package.json': 'config',
      'docs/guide.md': 'other',
    });
    const db = files.get('server/store/db.ts')!;
    expect(db).toMatchObject({ changeCount: 2, authorCount: 2 });
    expect(Date.now() - Date.parse(db.lastChangedAt!)).toBeLessThan(10 * 60_000);
    expect(files.get('web/format.ts')).toMatchObject({ changeCount: 1, authorCount: 1 });
    expect(JSON.stringify([...files.values()])).not.toContain('ada@example.com');

    const total = (kind: MapFile['kind']) =>
      areas.reduce((sum, area) => sum + area.kindCounts[kind], 0);
    for (const kind of ['ui', 'api', 'data', 'test', 'config', 'other'] as const) {
      expect(total(kind)).toBe([...files.values()].filter((file) => file.kind === kind).length);
    }
  });

  it('reports the Core areas and key files a set of changed paths touches', async () => {
    const { api, areas, files } = await built();
    const store = areas.find((area) => area.root === 'server')!;
    const storeFile = [...files.values()].find((file) => file.areaId === store.id)!;
    await api.send('put', `/api/projects/${projectId}/map/areas/${store.id}/category`, {
      category: 'core',
    });
    const docs = areas.find((area) => area.root === 'docs')!;
    await api.send('put', `/api/projects/${projectId}/map/areas/${docs.id}/category`, {
      category: 'feature',
    });
    const top = [...files.values()].sort((a, b) => b.importance - a.importance)[0]!;

    const impact = await coreImpact(t.db, root, [storeFile.path, 'docs/guide.md', 'nope.ts']);
    expect(impact.areas).toEqual([{ id: store.id, name: store.name, files: 1 }]);
    const withTop = await coreImpact(t.db, root, [top.path, 'docs/guide.md']);
    expect(withTop.keyFiles).toEqual([top.path]);
    expect(await coreImpact(t.db, root, ['docs/guide.md'])).toEqual({ areas: [], keyFiles: [] });
    expect(await coreImpact(t.db, '/elsewhere', [storeFile.path])).toEqual({
      areas: [],
      keyFiles: [],
    });
  });
});
