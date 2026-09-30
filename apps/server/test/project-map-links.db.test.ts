import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stopParseWorker } from '../src/codescan/parse-pool.ts';
import { createTestApp, localClient } from './app-support.ts';
import {
  addProject,
  connectJev,
  fakeJev,
  firstOptions,
  mapBuilder,
  writeRepo,
  type JevAnswerer,
} from './map-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const BACKEND: Record<string, string> = {
  'package.json': '{ "name": "shop-api", "dependencies": { "express": "5" } }',
  'src/app.ts': [
    "import express from 'express';",
    "import { orders } from './routes/orders';",
    "import { users } from './routes/users';",
    "import { reports } from './routes/reports';",
    "import { health } from './routes/health';",
    'const app = express();',
    "app.use('/api', orders);",
    "app.use('/api', users);",
    "app.use('/api/v1', reports);",
    'app.use(health);',
    'Sentry.init({ dsn: process.env.SENTRY_DSN, env: process.env.NODE_ENV });',
    'export default app;',
  ].join('\n'),
  'src/routes/orders.ts': [
    "import { Router } from 'express';",
    "import type { Order } from '@shop/types';",
    'export const orders = Router();',
    "orders.get('/orders', list);",
    "orders.get('/orders/:orderId', show);",
    "orders.post('/orders', create);",
    "orders.delete('/orders/:orderId', remove);",
    "orders.get('/orders/:orderId/items', items);",
  ].join('\n'),
  'src/routes/users.ts': [
    "import { Router } from 'express';",
    'export const users = Router();',
    "users.get('/users/me', me);",
    "users.get('/users/:userId', show);",
    "users.patch('/users/:userId', update);",
  ].join('\n'),
  'src/routes/reports.ts': [
    "import { Router } from 'express';",
    'export const reports = Router();',
    "reports.get('/reports/daily', daily);",
    "reports.get('/reports/:kind', byKind);",
  ].join('\n'),
  'src/routes/health.ts':
    "import { Router } from 'express';\nexport const health = Router();\nhealth.get('/health', ok);\n",
  'test/orders.test.ts':
    "import request from 'supertest';\nawait request(app).get('/api/orders');\n",
};

const FRONTEND: Record<string, string> = {
  'package.json': '{ "name": "@shop/web" }',
  'src/api/client.ts':
    'const API = import.meta.env.VITE_API_URL;\nexport const get = (path: string) => fetch(`${API}${path}`);\n',
  'src/api/orders.ts': [
    "import axios from 'axios';",
    "import type { Order } from '@shop/types';",
    "export const listOrders = () => fetch('/api/orders');",
    'export const getOrder = (id: string) => fetch(`/api/orders/${id}`);',
    "export const createOrder = (order: Order) => fetch('/api/orders', { method: 'POST', body: JSON.stringify(order) });",
    'export const deleteOrder = (id: string) => axios.delete(`/api/orders/${id}`);',
    'export const orderItems = (id: string) => fetch(`/api/orders/${id}/items`);',
    "export const charge = () => fetch('https://api.stripe.com/v1/charges', { method: 'POST' });",
  ].join('\n'),
  'src/api/users.ts': [
    "import axios from 'axios';",
    "export const me = () => fetch('/api/users/me');",
    'export const rename = (userId: string, name: string) => axios.patch(`/api/users/${userId}`, { name });',
  ].join('\n'),
  'src/api/reports.ts': [
    'const API_BASE = import.meta.env.VITE_API_URL;',
    'export const daily = () => fetch(`${API_BASE}/api/v1/reports/daily`);',
    'export const report = (kind: string) => fetch(`/api/v1/reports/${kind}`);',
  ].join('\n'),
  'src/api/orders-dynamic.ts':
    "const collection = 'orders';\nexport const byId = (id: string) => fetch(`/api/${collection}/${id}`);\n",
  'src/pages/Orders.tsx':
    "import useSWR from 'swr';\nexport function Orders() { const { data } = useSWR('/api/orders'); return <ul>{data}</ul>; }\n",
  'src/monitoring.ts':
    'Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, mode: import.meta.env.MODE });\n',
};

const EXPECTED_HTTP = [
  'src/api/orders-dynamic.ts GET /api/orders/:orderId',
  'src/api/orders.ts DELETE /api/orders/:orderId',
  'src/api/orders.ts GET /api/orders',
  'src/api/orders.ts GET /api/orders/:orderId',
  'src/api/orders.ts GET /api/orders/:orderId/items',
  'src/api/orders.ts POST /api/orders',
  'src/api/reports.ts GET /api/v1/reports/:kind',
  'src/api/reports.ts GET /api/v1/reports/daily',
  'src/api/users.ts GET /api/users/me',
  'src/api/users.ts PATCH /api/users/:userId',
  'src/pages/Orders.tsx GET /api/orders',
];

const pickOrders: JevAnswerer = (request) => {
  if (!('route' in request.questions)) return firstOptions(request);
  const options = Object.keys(request.questions.route?.criteria ?? {});
  return { route: options.find((option) => option.includes('/orders/')) ?? 'none' };
};

let t: TestDb;
const roots: string[] = [];

beforeEach(async () => {
  t = await createTestDb();
  await connectJev(t);
});

afterEach(async () => {
  await t.cleanup();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
  await stopParseWorker();
});

async function project(files: Record<string, string>, name: string): Promise<string> {
  const root = await writeRepo(files);
  roots.push(root);
  return addProject(t, root, name);
}

describe('cross-repo links', () => {
  it('links a React front end to its Express API with full precision on the fixture', async () => {
    const be = await project(BACKEND, 'shop-api');
    const fe = await project(FRONTEND, 'shop-web');
    const jev = fakeJev(pickOrders);
    const { builder, scanner } = mapBuilder(t, jev.fetch);
    expect(await builder.runOnce()).toBe(true);
    expect(await builder.runOnce()).toBe(true);
    await scanner.idle();

    const api = localClient(createTestApp(t));
    const response = await api.get(`/api/map/links?projects=${fe},${be}`);
    expect(response.status).toBe(200);
    const links = response.body.links as {
      kind: string;
      label: string;
      fromProjectId: string;
      fromPath: string;
      toPath: string;
      source: string;
      confidence: number;
    }[];
    const http = links
      .filter((link) => link.kind === 'http')
      .map((link) => `${link.fromPath} ${link.label}`)
      .sort();
    const correct = http.filter((link) => EXPECTED_HTTP.includes(link));
    expect({
      precision: correct.length / http.length,
      recall: correct.length / EXPECTED_HTTP.length,
    }).toEqual({
      precision: 1,
      recall: 1,
    });
    expect(
      links.filter((link) => link.kind === 'http').every((link) => link.fromProjectId === fe),
    ).toBe(true);
    expect(links.find((link) => link.fromPath === 'src/api/orders-dynamic.ts')).toMatchObject({
      source: 'jev',
      toPath: 'src/routes/orders.ts',
    });
    expect(
      links
        .filter((link) => link.kind !== 'http')
        .map((link) => `${link.kind} ${link.label}`)
        .sort(),
    ).toEqual(['env SENTRY_DSN', 'package @shop/types']);
    expect(response.body.areaLinks.length).toBeGreaterThan(0);
    const linkQuestions = jev.requests.filter((request) => 'route' in request.questions);
    expect(linkQuestions).toHaveLength(1);
    expect(JSON.stringify(linkQuestions[0]?.state)).toContain('collection');
  });

  it('lists routes nothing calls and calls that reach no route across the selected projects', async () => {
    const be = await project(BACKEND, 'shop-api');
    const fe = await project(FRONTEND, 'shop-web');
    const { builder, scanner } = mapBuilder(t, fakeJev(pickOrders).fetch);
    await builder.runOnce();
    await builder.runOnce();
    await scanner.idle();

    const api = localClient(createTestApp(t));
    const response = await api.get(`/api/map/unmatched?projects=${fe},${be}`);
    expect(response.status).toBe(200);
    const show = (entries: { projectId: string; method: string; path: string; file: string }[]) =>
      entries.map(
        (entry) =>
          `${entry.projectId === be ? 'api' : 'web'} ${entry.method} ${entry.path} ${entry.file}`,
      );
    expect(show(response.body.routes).sort()).toEqual([
      'api GET /health src/routes/health.ts',
      'api GET /users/:userId src/routes/users.ts',
    ]);
    expect(show(response.body.calls)).toEqual(['web POST /v1/charges src/api/orders.ts']);
    expect(response.body).toMatchObject({ routeTotal: 2, callTotal: 1 });
    expect(response.body.routes[0].confirmedBy).toBeNull();
    expect((await api.get(`/api/map/unmatched?projects=${fe}`)).status).toBe(400);
  });

  it('recomputes links only when either side changes and rejects bad selections', async () => {
    const be = await project(BACKEND, 'shop-api');
    const fe = await project(FRONTEND, 'shop-web');
    const { builder, scanner } = mapBuilder(t, fakeJev(pickOrders).fetch);
    await builder.runOnce();
    await builder.runOnce();
    await scanner.idle();
    const before = await t.db.query<{ computed_at: Date }>(
      'SELECT computed_at FROM map_link_pairs',
    );
    expect(before.rows).toHaveLength(1);
    expect(await builder.runOnce()).toBe(false);
    const after = await t.db.query<{ computed_at: Date }>('SELECT computed_at FROM map_link_pairs');
    expect(after.rows).toEqual(before.rows);

    const api = localClient(createTestApp(t));
    expect((await api.get(`/api/map/links?projects=${fe}`)).status).toBe(400);
    expect(
      (await api.get(`/api/map/links?projects=${fe},00000000-0000-4000-8000-000000000000`)).status,
    ).toBe(404);
    expect((await api.get(`/api/map/links?projects=${fe},${be}`)).body.projects).toHaveLength(2);
  });

  it('keeps ambiguous dynamic calls as low-confidence candidates when Jev is not connected', async () => {
    await project(BACKEND, 'shop-api');
    await project(FRONTEND, 'shop-web');
    await t.db.query('DELETE FROM advisor_connections');
    const { builder, scanner } = mapBuilder(t, fakeJev().fetch);
    await builder.runOnce();
    await builder.runOnce();
    await scanner.idle();
    const { rows } = await t.db.query<{ label: string; confidence: number }>(
      `SELECT label, confidence FROM map_links WHERE kind = 'http' ORDER BY label`,
    );
    const confident = rows.filter((row) => row.confidence >= 0.5).map((row) => row.label);
    const unsure = rows.filter((row) => row.confidence < 0.5).map((row) => row.label);
    expect(confident).toHaveLength(EXPECTED_HTTP.length - 1);
    expect(unsure).toEqual([
      'GET /api/orders/:orderId',
      'GET /api/reports/:kind',
      'GET /api/users/:userId',
    ]);
    expect(await t.db.query('SELECT 1 FROM map_jev_calls')).toMatchObject({ rowCount: 0 });
  });
});
