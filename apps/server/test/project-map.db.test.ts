import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { queueRepo } from '../src/map/store.ts';
import { listen } from '../src/persistence/notifications.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  addProject,
  connectJev,
  fakeJev,
  git,
  mapBuilder,
  writeFiles,
  writeRepo,
} from './map-support.ts';
import { createTestDb, startChat, testDatabaseUrl, type TestDb } from './support.ts';

const TOKEN = `ghp_${'a1'.repeat(15)}`;

const FILES: Record<string, string> = {
  'package.json': '{ "name": "shop" }',
  'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["web/*"] } } }',
  '.env': 'SECRET_TOKEN=do-not-send-this\n',
  'server/app.ts':
    "import express from 'express';\nimport { orders } from './orders';\nimport { session } from './auth/session';\nconst app = express();\napp.use('/api', orders);\nexport { app, session };\n",
  'server/orders.ts':
    "import { Router } from 'express';\nimport { money } from '../shared/money';\nexport const orders = Router();\norders.get('/orders/:id', (req, res) => res.json(money(1)));\n",
  'server/auth/session.ts': `export const session = { token: "${TOKEN}" };\n`,
  'server/db.ts': "import { money } from '../shared/money';\nexport const db = money(0);\n",
  'shared/money.ts': 'export function money(value: number) { return value.toFixed(2); }\n',
  'shared/format.ts':
    "import { money } from './money';\nexport const show = (v: number) => `$${money(v)}`;\n",
  'web/main.tsx':
    "import { show } from '../shared/format';\nimport { Orders } from '@/orders';\nexport const App = () => <Orders label={show(1)} />;\n",
  'web/orders.tsx':
    "export function Orders(props: { label: string }) { fetch('/api/orders/1'); return <p>{props.label}</p>; }\n",
  'web/util.ts': "import { money } from '../shared/money';\nexport const u = money;\n",
  'docs/guide.md': '# Guide\n',
};

let t: TestDb;
let root: string;
let projectId: string;

async function repo() {
  const { rows } = await t.db.query<{
    id: string;
    status: string;
    phase: string;
    area_count: number;
    edge_count: number;
  }>('SELECT id, status, phase, area_count, edge_count FROM map_repos WHERE root_path = $1', [
    root,
  ]);
  return rows[0]!;
}

async function positions() {
  const { rows } = await t.db.query<{ path: string; x: number; y: number }>(
    'SELECT path, x, y FROM map_files ORDER BY path',
  );
  return new Map(rows.map((row) => [row.path, { x: row.x, y: row.y }]));
}

beforeEach(async () => {
  t = await createTestDb();
  root = await writeRepo(FILES);
  projectId = await addProject(t, root);
  await connectJev(t);
});

afterEach(async () => {
  await t.cleanup();
  await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

describe('project map builder', () => {
  it('builds areas, import edges, layout and Jev labels, and serves them read-only', async () => {
    const jev = fakeJev();
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();

    expect(await repo()).toMatchObject({ status: 'ready', phase: 'done', area_count: 5 });
    const edges = await t.db.query<{ from_path: string; to_path: string }>(
      'SELECT from_path, to_path FROM map_edges ORDER BY 1, 2',
    );
    expect(edges.rows.map((row) => `${row.from_path} -> ${row.to_path}`)).toEqual([
      'server/app.ts -> server/auth/session.ts',
      'server/app.ts -> server/orders.ts',
      'server/db.ts -> shared/money.ts',
      'server/orders.ts -> shared/money.ts',
      'shared/format.ts -> shared/money.ts',
      'web/main.tsx -> shared/format.ts',
      'web/main.tsx -> web/orders.tsx',
      'web/util.ts -> shared/money.ts',
    ]);

    const sent = JSON.stringify(jev.requests);
    expect(jev.requests).toHaveLength(5);
    expect(sent).toContain('export function money');
    expect(sent).not.toContain('do-not-send-this');
    expect(sent).not.toContain(TOKEN);
    const recorded = await t.db.query<{ asked: unknown; jev_status: string; input_tokens: number }>(
      'SELECT asked, jev_status, input_tokens FROM map_jev_calls',
    );
    expect(recorded.rows).toHaveLength(5);
    expect(
      recorded.rows.every((row) => row.jev_status === 'answered' && row.input_tokens === 1000),
    ).toBe(true);
    expect(JSON.stringify(recorded.rows)).not.toContain(TOKEN);

    const api = localClient(createTestApp(t));
    const map = await api.get(`/api/projects/${projectId}/map`);
    expect(map.status).toBe(200);
    expect(map.body.status).toMatchObject({ status: 'ready', fileCount: 13, areaCount: 5 });
    const shared = map.body.areas.find((area: { root: string }) => area.root === 'shared');
    expect(shared).toMatchObject({
      category: 'core',
      categorySource: 'jev',
      name: 'Shared',
      fanIn: 4,
    });
    const web = map.body.areas.find((area: { root: string }) => area.root === 'web');
    expect(map.body.areaEdges).toContainEqual({ from: web.id, to: shared.id, weight: 2 });

    const detail = await api.get(`/api/projects/${projectId}/map/areas/${shared.id}?limit=1`);
    expect(detail.status).toBe(200);
    expect(detail.body.files.map((file: { path: string }) => file.path)).toEqual([
      'shared/money.ts',
    ]);
    expect(detail.body.nextOffset).toBe(1);
    expect(detail.body.files[0].reasons).toContain('imported by 4');
    expect((await api.get(`/api/projects/${projectId}/map/areas/000000000000`)).status).toBe(404);
    expect((await api.get(`/api/projects/${projectId}/map/areas/nope`)).status).toBe(400);
  });

  it('refreshes after a commit, moving only changed nodes and asking Jev only about changed areas', async () => {
    const jev = fakeJev();
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    await builder.runOnce();
    const before = await positions();
    expect(await builder.runOnce()).toBe(false);

    await writeFiles(root, {
      'web/cart.tsx': "import { u } from './util';\nexport const Cart = () => u(2);\n",
      'mobile/app.ts': "import { money } from '../shared/money';\nexport const m = money(3);\n",
    });
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'cart');
    const asked = jev.requests.length;
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();

    const after = await positions();
    for (const [path, point] of before) expect(after.get(path)).toEqual(point);
    expect(after.has('web/cart.tsx')).toBe(true);
    expect(jev.requests.length - asked).toBe(1);
    const { rows } = await t.db.query('SELECT 1 FROM map_edges WHERE from_path = $1', [
      'web/cart.tsx',
    ]);
    expect(rows).toHaveLength(1);
  });

  it('keeps user category overrides across rebuilds and rule changes', async () => {
    const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
    await builder.runOnce();
    const api = localClient(createTestApp(t));
    const map = await api.get(`/api/projects/${projectId}/map`);
    const docs = map.body.areas.find((area: { root: string }) => area.root === 'docs');
    const put = await api.send('put', `/api/projects/${projectId}/map/areas/${docs.id}/category`, {
      category: 'feature',
    });
    expect(put.body).toMatchObject({ category: 'feature', categorySource: 'override' });
    expect(
      (
        await api.send('put', `/api/projects/${projectId}/map/areas/${docs.id}/category`, {
          category: 'x',
        })
      ).status,
    ).toBe(400);

    const { id } = await repo();
    await t.db.query(`UPDATE map_repos SET rules_version = 'map-rules-0' WHERE id = $1`, [id]);
    await queueRepo(t.db, id, 'forced');
    await builder.runOnce();
    await scanner.idle();
    const rebuilt = await api.get(`/api/projects/${projectId}/map`);
    expect(rebuilt.body.areas.find((area: { id: string }) => area.id === docs.id)).toMatchObject({
      category: 'feature',
      categorySource: 'override',
    });
    await api.send('put', `/api/projects/${projectId}/map/areas/${docs.id}/category`, {
      category: null,
    });
    const cleared = await api.get(`/api/projects/${projectId}/map`);
    expect(
      cleared.body.areas.find((area: { id: string }) => area.id === docs.id).categorySource,
    ).toBe('jev');
  });

  it('waits for agent runs, pauses mid-build when one starts, and publishes progress events', async () => {
    const events: string[] = [];
    const listener = await listen(testDatabaseUrl(), 'changes', (payload) => {
      const event = JSON.parse(payload) as { kind: string; mapId?: string };
      if (event.kind === 'map' && event.mapId) events.push(event.mapId);
    });
    try {
      const queued = await startChat(t, 'busy');
      let started: string | null = null;
      const jev = fakeJev(undefined, async () => {
        if (started) return;
        started = (await startChat(t, 'another run')).runId;
      });
      const { builder, scanner } = mapBuilder(t, jev.fetch);
      expect(await builder.runOnce()).toBe(false);
      expect((await repo()).status).toBe('queued');

      await t.db.query(`UPDATE runs SET status = 'cancelled' WHERE id = $1`, [queued.runId]);
      const building = builder.runOnce();
      await expect.poll(async () => (await repo()).status, { timeout: 10_000 }).toBe('paused');
      await t.db.query(`UPDATE runs SET status = 'cancelled' WHERE id = $1`, [started]);
      expect(await building).toBe(true);
      await scanner.idle();
      expect(await repo()).toMatchObject({ status: 'ready' });
      const { id } = await repo();
      await expect.poll(() => events.filter((mapId) => mapId === id).length).toBeGreaterThan(2);
    } finally {
      await listener.close();
    }
  });

  it('resumes an interrupted build from the phase it reached without repeating finished labels', async () => {
    let calls = 0;
    let stop: () => void = () => undefined;
    const jev = fakeJev(undefined, async () => {
      calls += 1;
      if (calls === 2) stop();
    });
    const first = mapBuilder(t, jev.fetch);
    stop = () => first.builder.stop();
    expect(await first.builder.runOnce()).toBe(true);
    await first.scanner.idle();
    expect(await repo()).toMatchObject({ status: 'building', phase: 'labels' });
    const labelled = await t.db.query('SELECT area_id FROM map_labels');
    expect(labelled.rows).toHaveLength(2);

    const second = mapBuilder(t, jev.fetch);
    expect(await second.builder.runOnce()).toBe(true);
    await second.scanner.idle();
    expect(await repo()).toMatchObject({ status: 'ready' });
    expect(jev.requests).toHaveLength(5);
  });
});
