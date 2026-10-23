import type { IncomingMessage, ServerResponse } from 'node:http';

export const SERVICENOW_USER = 'jordan.lee';
export const SERVICENOW_PASSWORD = 'fake-password-0123';
export const SERVICENOW_API_KEY = 'now_fake_api_key_0123456789';
export const SERVICENOW_ME = 'u-jordan';

export interface FakeServiceNowUser {
  sys_id: string;
  user_name: string;
  name: string;
}

export interface FakeServiceNow {
  users: FakeServiceNowUser[];
  denied: Set<string>;
  limited: number;
  foreign: boolean;
  calls: string[];
  handles(path: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  reset(): void;
}

const TABLE = /^\/api\/now\/table\/([a-z_]+)$/;
const KNOWN_TABLES = new Set([
  'sys_user',
  'incident',
  'sc_req_item',
  'sc_task',
  'change_request',
  'problem',
]);
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

function seedUsers(): FakeServiceNowUser[] {
  return [
    { sys_id: SERVICENOW_ME, user_name: SERVICENOW_USER, name: 'Jordan Lee' },
    { sys_id: 'u-priya', user_name: 'priya.nair', name: 'Priya Nair' },
  ];
}

function userRows(fake: FakeServiceNow, query: string) {
  const name = /^user_name=(.+)$/.exec(query)?.[1];
  return fake.users.filter((user) => user.user_name === name);
}

export function fakeServiceNow(): FakeServiceNow {
  const fake: FakeServiceNow = {
    users: seedUsers(),
    denied: new Set(),
    limited: 0,
    foreign: false,
    calls: [],
    handles: (path) => path.startsWith('/api/now/'),
    reset() {
      fake.users = seedUsers();
      fake.denied = new Set();
      fake.limited = 0;
      fake.foreign = false;
      fake.calls = [];
    },
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://servicenow.test');
      fake.calls.push(`${req.method ?? 'GET'} ${url.pathname}${url.search}`);
      if (fake.foreign) return send(res, 200, { page: 'Welcome' });
      if (!signedIn(req)) return failure(res, 401, 'User Not Authenticated');
      if (fake.limited > 0) {
        fake.limited -= 1;
        return failure(res, 429, 'Rate limit exceeded', { 'retry-after': '30' });
      }
      const table = TABLE.exec(url.pathname)?.[1];
      if (!table || !KNOWN_TABLES.has(table)) return failure(res, 400, 'Invalid table');
      if (fake.denied.has(table)) return failure(res, 403, 'Insufficient rights');
      if (table === 'sys_user') {
        return send(res, 200, {
          result: userRows(fake, url.searchParams.get('sysparm_query') ?? ''),
        });
      }
      return send(res, 200, { result: [] });
    },
  };
  return fake;
}
