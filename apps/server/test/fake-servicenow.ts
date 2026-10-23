import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  CHOICES,
  GROUP_NAMES,
  isActive,
  MEMBERSHIPS,
  PRIORITY_LABELS,
  seedRecords,
  SERVICENOW_ME,
  stamp,
  USER_NAMES,
  type FakeRecord,
} from './fake-servicenow-data.ts';
import { matchesQuery } from './fake-servicenow-query.ts';

export { SERVICENOW_ME } from './fake-servicenow-data.ts';
export const SERVICENOW_USER = 'jordan.lee';
export const SERVICENOW_PASSWORD = 'fake-password-0123';
export const SERVICENOW_API_KEY = 'now_fake_api_key_0123456789';

export interface FakeServiceNowUser {
  sys_id: string;
  user_name: string;
  name: string;
}

export interface FakeServiceNow {
  users: FakeServiceNowUser[];
  records: FakeRecord[];
  denied: Set<string>;
  limited: number;
  foreign: boolean;
  redirectTo: string | null;
  calls: string[];
  writes: { table: string; sysId: string; body: Record<string, string> }[];
  handles(path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  reset(): void;
}

const TABLE = /^\/api\/now\/table\/([a-z_]+)(?:\/([0-9a-f]{32}))?$/;
const RECORD_TABLES = new Set(Object.keys(CHOICES));
const BASIC = `Basic ${Buffer.from(`${SERVICENOW_USER}:${SERVICENOW_PASSWORD}`).toString('base64')}`;

function send(res: ServerResponse, status: number, body: unknown, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function failure(res: ServerResponse, status: number, message: string, headers = {}) {
  send(res, status, { error: { message, detail: null }, status: 'failure' }, headers);
}

function signedIn(req: IncomingMessage): boolean {
  return req.headers.authorization === BASIC || req.headers['x-sn-apikey'] === SERVICENOW_API_KEY;
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return JSON.parse(text || '{}') as Record<string, string>;
}

function seedUsers(): FakeServiceNowUser[] {
  return [
    { sys_id: SERVICENOW_ME, user_name: SERVICENOW_USER, name: 'Jordan Lee' },
    { sys_id: '46d44a23a9fe19810012d100cca80666', user_name: 'priya.nair', name: 'Priya Nair' },
  ];
}

const choiceLabel = (record: FakeRecord) =>
  CHOICES[record.table]?.find(([value]) => value === record.state)?.[1] ?? record.state;

function displayOf(record: FakeRecord, field: string): string {
  if (field === 'state') return choiceLabel(record);
  if (field === 'priority') return PRIORITY_LABELS[record.priority] ?? record.priority;
  if (field === 'assigned_to' || field === 'caller_id') {
    return USER_NAMES[valueOf(record, field)] ?? '';
  }
  if (field === 'assignment_group') return GROUP_NAMES[record.assignment_group] ?? '';
  return valueOf(record, field);
}

function journalText(record: FakeRecord, element: 'work_notes' | 'comments'): string {
  const kind = element === 'work_notes' ? 'Work notes' : 'Additional comments';
  return record.journal
    .filter((entry) => entry.element === element)
    .map((entry) => `${entry.on} - ${entry.by} (${kind})\n${entry.value}\n\n`)
    .join('');
}

function valueOf(record: FakeRecord, field: string): string {
  if (field === 'active') return String(isActive(record));
  if (field === 'sys_class_name') return record.table;
  if (field === 'work_notes' || field === 'comments') return journalText(record, field);
  const value = (record as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function shape(record: FakeRecord, fields: string[], display: string | null) {
  return Object.fromEntries(
    fields.map((field) => {
      if (display === 'all') {
        return [field, { value: valueOf(record, field), display_value: displayOf(record, field) }];
      }
      return [field, display === 'true' ? displayOf(record, field) : valueOf(record, field)];
    }),
  );
}

function listRecords(fake: FakeServiceNow, table: string, url: URL) {
  const query = url.searchParams.get('sysparm_query') ?? '';
  const fields = (url.searchParams.get('sysparm_fields') ?? 'sys_id,number').split(',');
  const limit = Number(url.searchParams.get('sysparm_limit') ?? 10_000);
  return fake.records
    .filter((record) => record.table === table)
    .filter((record) => matchesQuery(query, (field) => valueOf(record, field)))
    .sort((a, b) => b.sys_updated_on.localeCompare(a.sys_updated_on))
    .slice(0, limit)
    .map((record) => shape(record, fields, url.searchParams.get('sysparm_display_value')));
}

function systemRows(fake: FakeServiceNow, table: string, url: URL): unknown[] | null {
  const query = url.searchParams.get('sysparm_query') ?? '';
  if (table === 'sys_user') {
    const name = /^user_name=(.+)$/.exec(query)?.[1];
    return fake.users.filter((user) => user.user_name === name);
  }
  if (table === 'sys_user_grmember') {
    const user = /^user=(.+)$/.exec(query)?.[1];
    return MEMBERSHIPS.filter(([member]) => member === user).map(([, group]) => ({
      group:
        url.searchParams.get('sysparm_exclude_reference_link') === 'true'
          ? group
          : { link: `https://x/${group}`, value: group },
    }));
  }
  if (table === 'sys_choice') {
    const name = /^name=([a-z_]+)\^/.exec(query)?.[1] ?? '';
    return (CHOICES[name] ?? []).map(([value, label]) => ({ value, label }));
  }
  if (table === 'sys_journal_field') {
    const id = /^element_id=([0-9a-f]{32})/.exec(query)?.[1];
    const record = fake.records.find((entry) => entry.sys_id === id);
    return (record?.journal ?? []).map((entry) => ({
      element: entry.element,
      value: entry.value,
      sys_created_on: entry.on,
      sys_created_by: entry.by,
    }));
  }
  return null;
}

const JOURNAL_FIELDS = new Set(['work_notes', 'comments']);

function patchRecord(fake: FakeServiceNow, record: FakeRecord, body: Record<string, string>) {
  for (const [field, value] of Object.entries(body)) {
    if (JOURNAL_FIELDS.has(field)) {
      const element = field as 'work_notes' | 'comments';
      record.journal.push({ element, value, by: SERVICENOW_USER, on: stamp(0) });
    } else {
      (record as unknown as Record<string, string>)[field] = value;
    }
  }
  record.sys_updated_on = stamp(0);
  fake.writes.push({ table: record.table, sysId: record.sys_id, body });
}

async function route(fake: FakeServiceNow, req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === '/api/now/attachment') {
    const id = /^table_sys_id=(.+)$/.exec(url.searchParams.get('sysparm_query') ?? '')?.[1];
    const record = fake.records.find((entry) => entry.sys_id === id);
    return send(res, 200, { result: record?.attachments ?? [] });
  }
  const [, table = '', sysId] = TABLE.exec(url.pathname) ?? [];
  if (!table) return failure(res, 400, 'Invalid table');
  if (fake.denied.has(table)) return failure(res, 403, 'Insufficient rights');
  if (!sysId) {
    const rows = systemRows(fake, table, url);
    if (rows) return send(res, 200, { result: rows });
    if (!RECORD_TABLES.has(table)) return failure(res, 400, 'Invalid table');
    return send(res, 200, { result: listRecords(fake, table, url) });
  }
  const record = fake.records.find((entry) => entry.table === table && entry.sys_id === sysId);
  if (!record) return failure(res, 404, 'No Record found');
  if (req.method === 'PATCH') patchRecord(fake, record, await readBody(req));
  const fields = (url.searchParams.get('sysparm_fields') ?? 'sys_id').split(',');
  return send(res, 200, {
    result: shape(record, fields, url.searchParams.get('sysparm_display_value')),
  });
}

export function fakeServiceNow(): FakeServiceNow {
  const fake: FakeServiceNow = {
    users: seedUsers(),
    records: seedRecords(),
    denied: new Set(),
    limited: 0,
    foreign: false,
    redirectTo: null,
    calls: [],
    writes: [],
    handles: (path) => path.startsWith('/api/now/'),
    reset() {
      fake.users = seedUsers();
      fake.records = seedRecords();
      fake.denied = new Set();
      fake.limited = 0;
      fake.foreign = false;
      fake.redirectTo = null;
      fake.calls = [];
      fake.writes = [];
    },
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://servicenow.test');
      fake.calls.push(`${req.method ?? 'GET'} ${url.pathname}${url.search}`);
      if (fake.foreign) return send(res, 200, { page: 'Welcome' });
      if (fake.redirectTo) {
        res.writeHead(302, { location: `${fake.redirectTo}${url.pathname}${url.search}` });
        res.end();
        return;
      }
      if (!signedIn(req)) return failure(res, 401, 'User Not Authenticated');
      if (fake.limited > 0) {
        fake.limited -= 1;
        return failure(res, 429, 'Rate limit exceeded', { 'retry-after': '30' });
      }
      return route(fake, req, res, url);
    },
  };
  return fake;
}
