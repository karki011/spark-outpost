import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MICROSOFT_EDIT_SCOPES, microsoftScopesEdit } from '@spark-outpost/contracts';
import type { GraphCalendar, GraphEvent } from '../src/calendar/microsoft/api.ts';

export const FAKE_MICROSOFT_CLIENT_ID = '0f6c2a8e-3b1d-4c5e-9a7f-1e2d3c4b5a69';
const TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

interface FakeCalendar {
  entry: GraphCalendar;
  events: Map<string, { event: GraphEvent | null; version: number }>;
}

interface FakeUser {
  oid: string;
  email: string;
  calendars: Map<string, FakeCalendar>;
  masters: Map<string, string>;
}

interface IssuedCode {
  oid: string;
  challenge: string;
  redirectUri: string;
  scopes: string[];
}

interface Failure {
  status: number;
  code?: string;
  retryAfter?: number;
}

export interface FakeGraphRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  prefer: string | null;
}

export interface FakeGraphWrite {
  method: 'POST' | 'PATCH' | 'DELETE';
  calendarId: string;
  eventId: string;
  body: Record<string, unknown> | null;
}

export interface FakeGraph {
  baseUrl: string;
  loginUrl: string;
  graphUrl: string;
  requests: FakeGraphRequest[];
  writes: FakeGraphWrite[];
  pageSize: number;
  grantedScopes: string[];
  deny: string | null;
  signInAs: string;
  idTokenEmail: boolean;
  addUser(oid: string, email: string): void;
  addCalendar(oid: string, entry: GraphCalendar): void;
  putEvent(oid: string, calendarId: string, event: GraphEvent): void;
  putMaster(oid: string, masterId: string, iCalUId: string): void;
  removeEvent(oid: string, calendarId: string, eventId: string): void;
  eventOf(oid: string, calendarId: string, eventId: string): GraphEvent | null;
  expireDeltaTokens(): void;
  expireRefreshTokens(): void;
  failNext(path: string, failure: Failure): void;
  refreshTokenRotations(): number;
  authorize(authorizeUrl: string): string;
  fetch: typeof fetch;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const unsignedJwt = (claims: Record<string, unknown>) =>
  [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'sig',
  ].join('.');

const asUtc = (value: string) => Date.parse(`${value.replace(/\.\d+$/, '')}Z`);

function overlaps(event: GraphEvent, from: string, to: string): boolean {
  const start = asUtc(event.start!.dateTime);
  const end = asUtc(event.end!.dateTime);
  return end > Date.parse(from) && start < Date.parse(to);
}

const graphError = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { error: { code, message: code } }, headers);

export function fakeMicrosoftGraph(baseUrl = 'http://127.0.0.1:9'): FakeGraph {
  const users = new Map<string, FakeUser>();
  const codes = new Map<string, IssuedCode>();
  const refreshTokens = new Map<string, { oid: string; scopes: string[] }>();
  const revoked = new Set<string>();
  const accessTokens = new Map<string, { oid: string; scopes: string[]; refresh: string }>();
  const failures = new Map<string, Failure[]>();
  let version = 1;
  let deltaEpoch = 1;
  let created = 0;
  let rotations = 0;

  const fake: FakeGraph = {
    baseUrl,
    loginUrl: `${baseUrl}/login`,
    graphUrl: `${baseUrl}/graph/v1.0`,
    requests: [],
    writes: [],
    pageSize: 2,
    grantedScopes: [...MICROSOFT_EDIT_SCOPES],
    deny: null,
    signInAs: '',
    idTokenEmail: true,
    addUser(oid, email) {
      users.set(oid, { oid, email, calendars: new Map(), masters: new Map() });
      if (!fake.signInAs) fake.signInAs = oid;
    },
    addCalendar(oid, entry) {
      users.get(oid)!.calendars.set(entry.id, { entry, events: new Map() });
    },
    putEvent(oid, calendarId, event) {
      version += 1;
      users.get(oid)!.calendars.get(calendarId)!.events.set(event.id, { event, version });
    },
    putMaster(oid, masterId, iCalUId) {
      users.get(oid)!.masters.set(masterId, iCalUId);
    },
    removeEvent(oid, calendarId, eventId) {
      version += 1;
      users.get(oid)!.calendars.get(calendarId)!.events.set(eventId, { event: null, version });
    },
    eventOf(oid, calendarId, eventId) {
      return users.get(oid)?.calendars.get(calendarId)?.events.get(eventId)?.event ?? null;
    },
    expireDeltaTokens() {
      deltaEpoch += 1;
    },
    expireRefreshTokens() {
      for (const token of refreshTokens.keys()) revoked.add(token);
    },
    failNext(path, failure) {
      failures.set(path, [...(failures.get(path) ?? []), failure]);
    },
    refreshTokenRotations: () => rotations,
    authorize(authorizeUrl) {
      const query = new URL(authorizeUrl).searchParams;
      const redirect = new URL(query.get('redirect_uri') ?? '');
      redirect.searchParams.set('state', query.get('state') ?? '');
      if (fake.deny) {
        redirect.searchParams.set('error', fake.deny);
        return redirect.toString();
      }
      if (query.get('client_id') !== FAKE_MICROSOFT_CLIENT_ID) throw new Error('wrong client');
      if (query.get('code_challenge_method') !== 'S256') throw new Error('no PKCE');
      const code = `M.code-${randomBytes(6).toString('hex')}`;
      const requested = (query.get('scope') ?? '').split(' ');
      codes.set(code, {
        oid: fake.signInAs,
        challenge: query.get('code_challenge') ?? '',
        redirectUri: query.get('redirect_uri') ?? '',
        scopes: requested.filter((scope) => fake.grantedScopes.includes(scope)),
      });
      redirect.searchParams.set('code', code);
      return redirect.toString();
    },
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const headers = new Headers(init?.headers);
      return handle(init?.method ?? 'GET', url, init?.body ? String(init.body) : '', headers);
    },
  };

  function issue(oid: string, scopes: string[], refresh: string) {
    const token = `eyJ0.fake-${randomBytes(6).toString('hex')}`;
    accessTokens.set(token, { oid, scopes, refresh });
    return token;
  }

  const graphScopes = (scopes: string[]) =>
    scopes.map((scope) => (/^[A-Z]/.test(scope) ? `https://graph.microsoft.com/${scope}` : scope));

  function token(body: URLSearchParams): Response {
    if (body.get('client_id') !== FAKE_MICROSOFT_CLIENT_ID) {
      return json(400, { error: 'invalid_client' });
    }
    if (body.has('client_secret')) return json(400, { error: 'invalid_request' });
    if (body.get('grant_type') === 'refresh_token') {
      const old = body.get('refresh_token') ?? '';
      const known = refreshTokens.get(old);
      if (!known || revoked.has(old)) return json(400, { error: 'invalid_grant' });
      const next = `M.R3_fake-${randomBytes(6).toString('hex')}`;
      refreshTokens.set(next, known);
      revoked.add(old);
      rotations += 1;
      return json(200, {
        access_token: issue(known.oid, known.scopes, next),
        expires_in: 3599,
        refresh_token: next,
        scope: graphScopes(known.scopes).join(' '),
      });
    }
    const code = codes.get(body.get('code') ?? '');
    codes.delete(body.get('code') ?? '');
    const verifier = createHash('sha256')
      .update(body.get('code_verifier') ?? '')
      .digest('base64url');
    if (!code || code.challenge !== verifier || code.redirectUri !== body.get('redirect_uri')) {
      return json(400, { error: 'invalid_grant' });
    }
    const user = users.get(code.oid)!;
    const refresh = `M.R3_fake-${randomBytes(6).toString('hex')}`;
    refreshTokens.set(refresh, { oid: user.oid, scopes: code.scopes });
    return json(200, {
      access_token: issue(user.oid, code.scopes, refresh),
      expires_in: 3599,
      refresh_token: refresh,
      scope: graphScopes(code.scopes).join(' '),
      id_token: unsignedJwt({
        iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
        aud: FAKE_MICROSOFT_CLIENT_ID,
        oid: user.oid,
        tid: TENANT,
        ...(fake.idTokenEmail ? { email: user.email } : {}),
      }),
    });
  }

  function caller(headers: Headers) {
    const access = accessTokens.get(headers.get('authorization')?.replace(/^Bearer /, '') ?? '');
    if (!access || revoked.has(access.refresh)) return null;
    const user = users.get(access.oid);
    return user ? { user, mayWrite: microsoftScopesEdit(access.scopes) } : null;
  }

  const page = <T>(items: T[], skip: number) => ({
    slice: items.slice(skip, skip + fake.pageSize),
    more: skip + fake.pageSize < items.length,
  });

  function calendars(user: FakeUser, query: URLSearchParams): Response {
    const skip = Number(query.get('$skip') ?? 0);
    const { slice, more } = page(
      [...user.calendars.values()].map((calendar) => calendar.entry),
      skip,
    );
    const next = `${fake.graphUrl}/me/calendars?$skip=${skip + fake.pageSize}`;
    return json(200, { value: slice, ...(more ? { '@odata.nextLink': next } : {}) });
  }

  function delta(user: FakeUser, calendarId: string, query: URLSearchParams): Response {
    const calendar = user.calendars.get(calendarId);
    if (!calendar) return graphError(404, 'ErrorItemNotFound');
    const base = `${fake.graphUrl}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`;
    const deltaToken = query.get('$deltatoken');
    const skipToken = query.get('$skiptoken');
    let state: { since: number; from: string; to: string; skip: number };
    if (deltaToken || skipToken) {
      const [epoch, since, from, to, skip] = (deltaToken ?? skipToken)!.split('~');
      if (Number(epoch) !== deltaEpoch) return graphError(410, 'syncStateNotFound');
      state = { since: Number(since), from: from!, to: to!, skip: deltaToken ? 0 : Number(skip) };
    } else {
      const from = query.get('startDateTime');
      const to = query.get('endDateTime');
      if (!from || !to) return graphError(400, 'ErrorInvalidParameter');
      state = { since: 0, from, to, skip: 0 };
    }
    const items = [...calendar.events.entries()]
      .filter(([, entry]) => entry.version > state.since)
      .flatMap(([id, entry]) => {
        if (!entry.event)
          return state.since === 0 ? [] : [{ id, '@removed': { reason: 'deleted' } }];
        return overlaps(entry.event, state.from, state.to) ? [entry.event] : [];
      });
    const { slice, more } = page(items, state.skip);
    const token = (skip: number) =>
      [deltaEpoch, more ? state.since : version, state.from, state.to, skip].join('~');
    return json(200, {
      value: slice,
      ...(more
        ? { '@odata.nextLink': `${base}?$skiptoken=${token(state.skip + fake.pageSize)}` }
        : { '@odata.deltaLink': `${base}?$deltatoken=${token(0)}` }),
    });
  }

  function write(
    user: FakeUser,
    method: FakeGraphWrite['method'],
    target: { calendarId: string; eventId: string | null },
    raw: string,
  ): Response {
    const calendar = user.calendars.get(target.calendarId);
    if (!calendar) return graphError(404, 'ErrorItemNotFound');
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const eventId = target.eventId ?? `AAMkCreated${(created += 1)}`;
    fake.writes.push({ method, calendarId: target.calendarId, eventId, body });
    const current = calendar.events.get(eventId)?.event ?? null;
    if (method !== 'POST' && !current) return graphError(404, 'ErrorItemNotFound');
    version += 1;
    if (method === 'DELETE') {
      calendar.events.set(eventId, { event: null, version });
      return new Response(null, { status: 204 });
    }
    const next = {
      ...(current ?? { id: eventId, iCalUId: `uid-${randomUUID()}`, type: 'singleInstance' }),
      ...body,
    } as GraphEvent;
    calendar.events.set(eventId, { event: next, version });
    return json(method === 'POST' ? 201 : 200, next);
  }

  function handle(method: string, url: URL, raw: string, headers: Headers): Response {
    const query = url.searchParams;
    fake.requests.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(query),
      prefer: headers.get('prefer'),
    });
    const queued = failures.get(url.pathname)?.shift();
    if (queued) {
      return graphError(
        queued.status,
        queued.code ?? 'ServiceUnavailable',
        queued.retryAfter === undefined ? {} : { 'retry-after': String(queued.retryAfter) },
      );
    }
    if (method === 'POST' && url.pathname === '/login/common/oauth2/v2.0/token') {
      return token(new URLSearchParams(raw));
    }
    const who = caller(headers);
    if (!who) return graphError(401, 'InvalidAuthenticationToken');
    const { user } = who;
    const path = url.pathname.replace('/graph/v1.0', '');
    if (path === '/me') return json(200, { mail: user.email, userPrincipalName: user.email });
    if (path === '/me/calendars') return calendars(user, query);
    const deltaMatch = /^\/me\/calendars\/([^/]+)\/calendarView\/delta$/.exec(path);
    if (deltaMatch) return delta(user, decodeURIComponent(deltaMatch[1]!), query);
    const list = /^\/me\/calendars\/([^/]+)\/events$/.exec(path);
    const single = /^\/me\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(path);
    if (method !== 'GET' && (list || single)) {
      if (!who.mayWrite) return graphError(403, 'ErrorAccessDenied');
      const calendarId = decodeURIComponent((list ?? single)![1]!);
      const eventId = single ? decodeURIComponent(single[2]!) : null;
      return write(user, method as FakeGraphWrite['method'], { calendarId, eventId }, raw);
    }
    if (single) {
      const calendar = user.calendars.get(decodeURIComponent(single[1]!));
      const found = calendar?.events.get(decodeURIComponent(single[2]!))?.event;
      const master = user.masters.get(decodeURIComponent(single[2]!));
      if (master) return json(200, { iCalUId: master });
      return found ? json(200, found) : graphError(404, 'ErrorItemNotFound');
    }
    return graphError(404, 'ResourceNotFound');
  }

  return fake;
}
