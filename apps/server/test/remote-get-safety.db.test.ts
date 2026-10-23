import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ROUTE_RULES } from '../src/remote/route-rules.ts';
import { createTestApp } from './app-support.ts';
import { pairDevice, remoteClient, setSwitches, turnRemoteOn } from './remote-support.ts';
import { createTestDb, type TestDb } from './support.ts';

const STREAMS = new Set(['GET /api/events']);
const WEB_APP_ROUTE = 'GET /{*path}';
const ANSWER_WITHIN_MS = 4000;
const DERIVED_ROWS = [
  'GET /api/home/digest: profiles',
  'GET /api/tickets/inbox: attention_snapshots',
];

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
  await turnRemoteOn(app);
  await setSwitches(app, { terminal: true, terminalApprove: true, artifacts: true });
});

afterEach(async () => {
  await t.cleanup();
});

async function fingerprint(): Promise<Record<string, string>> {
  const tables = await t.db.query<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const prints: Record<string, string> = {};
  for (const { name } of tables.rows) {
    const { rows } = await t.db.query<{ print: string }>(
      `SELECT count(*) || ':' || coalesce(md5(string_agg(row::text, '|' ORDER BY row::text)), '')
         AS print FROM "${name}" AS row`,
    );
    prints[name] = rows[0]!.print;
  }
  return prints;
}

function readableRoutes(): string[] {
  return [...ROUTE_RULES]
    .filter(([route, rule]) => route.startsWith('GET ') && rule !== 'never' && rule !== 'pairing')
    .map(([route]) => route)
    .filter((route) => route !== WEB_APP_ROUTE && !STREAMS.has(route));
}

it('writes only derived rows when a phone reads any route it is allowed to read', async () => {
  const device = await pairDevice(app);
  const phone = remoteClient(app, device.cookie);
  await phone.get('/api/health').expect(200);
  const routes = readableRoutes();
  expect(routes.length).toBeGreaterThan(50);
  const before = await fingerprint();
  const changed: string[] = [];
  let last = before;
  for (const route of routes) {
    const path = route.slice(4).replace(/:[A-Za-z]+/g, () => randomUUID());
    await phone
      .get(path)
      .timeout(ANSWER_WITHIN_MS)
      .catch(() => null);
    const after = await fingerprint();
    const tables = Object.keys(after).filter((name) => after[name] !== last[name]);
    if (tables.length > 0) changed.push(`${route}: ${tables.join(', ')}`);
    last = after;
  }
  expect(changed).toEqual(DERIVED_ROWS);
}, 240_000);
