import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GOOGLE_EDIT_SCOPES, GOOGLE_EVENTS_EDIT_SCOPE } from '@spark-outpost/contracts';
import type { GoogleCalendarEntry, GoogleEvent } from '../src/calendar/google/api.ts';

export const FAKE_GOOGLE_CLIENT_ID = '1234567890-fakeclient.apps.googleusercontent.com';
export const FAKE_GOOGLE_CLIENT_SECRET = 'GOCSPX-fake-desktop-secret';

interface FakeCalendar {
  entry: GoogleCalendarEntry;
  events: Map<string, { event: GoogleEvent; version: number }>;
}

interface FakeUser {
  subject: string;
  email: string;
  calendars: Map<string, FakeCalendar>;
}

interface IssuedCode {
  subject: string;
  challenge: string;
  redirectUri: string;
  scopes: string[];
}

interface Failure {
  status: number;
  reason?: string;
  retryAfter?: number;
}

export interface FakeGoogleRequest {
  method: string;
  path: string;
  query: Record<string, string>;
}

export interface FakeGoogleWrite {
  method: 'POST' | 'PATCH' | 'DELETE';
  calendarId: string;
  eventId: string;
  body: Record<string, unknown> | null;
  sendUpdates: string | null;
}

export interface FakeGoogle {
  baseUrl: string;
  requests: FakeGoogleRequest[];
  writes: FakeGoogleWrite[];
  revoked: Set<string>;
  pageSize: number;
  grantedScopes: string[];
  deny: string | null;
  signInAs: string;
  addUser(subject: string, email: string): void;
  addCalendar(subject: string, entry: GoogleCalendarEntry): void;
  putEvent(subject: string, calendarId: string, event: GoogleEvent): void;
  eventOf(subject: string, calendarId: string, eventId: string): GoogleEvent | null;
  cancelEvent(subject: string, calendarId: string, eventId: string): void;
  expireSyncTokens(): void;
  expireRefreshTokens(): void;
  failNext(path: string, failure: Failure): void;
  refreshTokensOf(subject: string): string[];
  forgetGrants(subject: string): void;
  authorize(authorizeUrl: string): string;
  fetch: typeof fetch;
  listen(): Promise<{ baseUrl: string; close(): Promise<void> }>;
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

function overlaps(event: GoogleEvent, timeMin: string, timeMax: string): boolean {
  const start = Date.parse(event.start?.dateTime ?? `${event.start?.date}T00:00:00`);
  const end = Date.parse(event.end?.dateTime ?? `${event.end?.date}T00:00:00`);
  return end > Date.parse(timeMin) && start < Date.parse(timeMax);
}

export function fakeGoogleCalendar(baseUrl = 'http://127.0.0.1:9'): FakeGoogle {
  const users = new Map<string, FakeUser>();
  const codes = new Map<string, IssuedCode>();
  const refreshTokens = new Map<string, string>();
  const accessTokens = new Map<string, { subject: string; refresh: string }>();
  const scopesOf = new Map<string, string[]>();
  const grantsOf = new Map<string, Set<string>>();
  let created = 0;
  const failures = new Map<string, Failure[]>();
  let version = 1;
  let syncEpoch = 1;

  const fake: FakeGoogle = {
    baseUrl,
    requests: [],
    writes: [],
    revoked: new Set(),
    pageSize: 2,
    grantedScopes: [...GOOGLE_EDIT_SCOPES],
    deny: null,
    signInAs: '',
    addUser(subject, email) {
      users.set(subject, { subject, email, calendars: new Map() });
      if (!fake.signInAs) fake.signInAs = subject;
    },
    addCalendar(subject, entry) {
      users.get(subject)!.calendars.set(entry.id, { entry, events: new Map() });
    },
    putEvent(subject, calendarId, event) {
      version += 1;
      const calendar = users.get(subject)!.calendars.get(calendarId)!;
      calendar.events.set(event.id, { event, version });
    },
    eventOf(subject, calendarId, eventId) {
      const found = users.get(subject)?.calendars.get(calendarId)?.events.get(eventId);
      return found && found.event.status !== 'cancelled' ? found.event : null;
    },
    cancelEvent(subject, calendarId, eventId) {
      version += 1;
      const calendar = users.get(subject)!.calendars.get(calendarId)!;
      calendar.events.set(eventId, { event: { id: eventId, status: 'cancelled' }, version });
    },
    expireSyncTokens() {
      syncEpoch += 1;
    },
    expireRefreshTokens() {
      for (const token of refreshTokens.keys()) fake.revoked.add(token);
    },
    failNext(path, failure) {
      failures.set(path, [...(failures.get(path) ?? []), failure]);
    },
    refreshTokensOf(subject) {
      return [...refreshTokens].filter(([, owner]) => owner === subject).map(([token]) => token);
    },
    forgetGrants(subject) {
      grantsOf.delete(subject);
    },
    authorize(authorizeUrl) {
      const url = new URL(authorizeUrl);
      const query = url.searchParams;
      const redirect = new URL(query.get('redirect_uri') ?? '');
      redirect.searchParams.set('state', query.get('state') ?? '');
      if (fake.deny) {
        redirect.searchParams.set('error', fake.deny);
        return redirect.toString();
      }
      if (query.get('client_id') !== FAKE_GOOGLE_CLIENT_ID) throw new Error('wrong client');
      if (query.get('code_challenge_method') !== 'S256') throw new Error('no PKCE');
      const code = `code-${randomBytes(6).toString('hex')}`;
      const requested = (query.get('scope') ?? '').split(' ');
      const earlier =
        query.get('include_granted_scopes') === 'true' ? (grantsOf.get(fake.signInAs) ?? []) : [];
      const allowed = requested.filter((scope) => fake.grantedScopes.includes(scope));
      codes.set(code, {
        subject: fake.signInAs,
        challenge: query.get('code_challenge') ?? '',
        redirectUri: query.get('redirect_uri') ?? '',
        scopes: [...new Set([...earlier, ...allowed])],
      });
      redirect.searchParams.set('code', code);
      return redirect.toString();
    },
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const raw = init?.body ? String(init.body) : '';
      const headers = new Headers(init?.headers);
      return handle(init?.method ?? 'GET', url, raw, headers.get('authorization'));
    },
    async listen() {
      const server: Server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const url = new URL(request.url ?? '/', fake.baseUrl);
        if (url.pathname === '/o/oauth2/v2/auth') {
          response.writeHead(302, { location: fake.authorize(url.toString()) }).end();
          return;
        }
        const answer = await handle(
          request.method ?? 'GET',
          url,
          Buffer.concat(chunks).toString('utf8'),
          request.headers.authorization ?? null,
        );
        response.writeHead(answer.status, Object.fromEntries(answer.headers));
        response.end(await answer.text());
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      fake.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return {
        baseUrl: fake.baseUrl,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      };
    },
  };

  function issueAccess(subject: string, refresh: string) {
    const token = `ya29.fake-${randomBytes(6).toString('hex')}`;
    accessTokens.set(token, { subject, refresh });
    return token;
  }

  function token(body: URLSearchParams): Response {
    if (body.get('client_id') !== FAKE_GOOGLE_CLIENT_ID)
      return json(401, { error: 'invalid_client' });
    if (body.get('client_secret') !== FAKE_GOOGLE_CLIENT_SECRET) {
      return json(401, { error: 'invalid_client' });
    }
    if (body.get('grant_type') === 'refresh_token') {
      const refresh = body.get('refresh_token') ?? '';
      const subject = refreshTokens.get(refresh);
      if (!subject || fake.revoked.has(refresh)) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: issueAccess(subject, refresh), expires_in: 3599 });
    }
    const code = codes.get(body.get('code') ?? '');
    codes.delete(body.get('code') ?? '');
    const verifier = createHash('sha256')
      .update(body.get('code_verifier') ?? '')
      .digest('base64url');
    if (!code || code.challenge !== verifier || code.redirectUri !== body.get('redirect_uri')) {
      return json(400, { error: 'invalid_grant' });
    }
    const user = users.get(code.subject)!;
    const refresh = `1//fake-refresh-${randomBytes(6).toString('hex')}`;
    refreshTokens.set(refresh, user.subject);
    scopesOf.set(refresh, code.scopes);
    grantsOf.set(user.subject, new Set(code.scopes));
    return json(200, {
      access_token: issueAccess(user.subject, refresh),
      expires_in: 3599,
      refresh_token: refresh,
      scope: code.scopes.join(' '),
      id_token: unsignedJwt({
        iss: 'https://accounts.google.com',
        aud: FAKE_GOOGLE_CLIENT_ID,
        sub: user.subject,
        email: user.email,
      }),
    });
  }

  function revoke(body: URLSearchParams): Response {
    const value = body.get('token') ?? '';
    const access = accessTokens.get(value);
    if (!refreshTokens.has(value) && !access) return json(400, { error: 'invalid_token' });
    const subject = access?.subject ?? refreshTokens.get(value);
    for (const [token, owner] of refreshTokens) {
      if (owner === subject) fake.revoked.add(token);
    }
    return json(200, {});
  }

  function caller(authorization: string | null): FakeUser | null {
    const access = accessTokens.get(authorization?.replace(/^Bearer /, '') ?? '');
    if (!access || fake.revoked.has(access.refresh)) return null;
    return users.get(access.subject) ?? null;
  }

  function mayWrite(authorization: string | null): boolean {
    const access = accessTokens.get(authorization?.replace(/^Bearer /, '') ?? '');
    return access ? (scopesOf.get(access.refresh) ?? []).includes(GOOGLE_EVENTS_EDIT_SCOPE) : false;
  }

  function write(
    user: FakeUser,
    method: FakeGoogleWrite['method'],
    target: { calendarId: string; eventId: string | null },
    raw: string,
    query: URLSearchParams,
  ): Response {
    const calendar = user.calendars.get(target.calendarId);
    if (!calendar) return json(404, { error: { errors: [{ reason: 'notFound' }] } });
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const eventId = target.eventId ?? `created-${(created += 1)}`;
    fake.writes.push({
      method,
      calendarId: target.calendarId,
      eventId,
      body,
      sendUpdates: query.get('sendUpdates'),
    });
    const current = calendar.events.get(eventId)?.event;
    if (method !== 'POST' && (!current || current.status === 'cancelled')) return json(404, {});
    version += 1;
    if (method === 'DELETE') {
      calendar.events.set(eventId, { event: { id: eventId, status: 'cancelled' }, version });
      return new Response(null, { status: 204 });
    }
    const next = {
      ...(current ?? { id: eventId, iCalUID: `${eventId}@google.com` }),
      ...body,
    } as GoogleEvent;
    calendar.events.set(eventId, { event: next, version });
    return json(200, next);
  }

  function page<T>(items: T[], query: URLSearchParams) {
    const start = Number(query.get('pageToken') ?? 0);
    const slice = items.slice(start, start + fake.pageSize);
    const next = start + fake.pageSize < items.length ? String(start + fake.pageSize) : null;
    return { slice, next };
  }

  function events(user: FakeUser, calendarId: string, query: URLSearchParams): Response {
    const calendar = user.calendars.get(calendarId);
    if (!calendar) return json(404, { error: { errors: [{ reason: 'notFound' }] } });
    const syncToken = query.get('syncToken');
    if (syncToken && ['timeMin', 'timeMax', 'orderBy', 'q'].some((name) => query.has(name))) {
      return json(400, { error: { errors: [{ reason: 'invalid' }] } });
    }
    if (query.get('singleEvents') !== 'true') return json(400, { error: 'singleEvents' });
    let items: GoogleEvent[];
    if (syncToken) {
      const [epoch, since] = syncToken.replace('sync-', '').split('.').map(Number);
      if (epoch !== syncEpoch)
        return json(410, { error: { errors: [{ reason: 'fullSyncRequired' }] } });
      items = [...calendar.events.values()]
        .filter((entry) => entry.version > since!)
        .map((entry) => entry.event);
    } else {
      items = [...calendar.events.values()]
        .map((entry) => entry.event)
        .filter((event) => event.status !== 'cancelled')
        .filter((event) => overlaps(event, query.get('timeMin')!, query.get('timeMax')!));
    }
    const { slice, next } = page(items, query);
    return json(200, {
      items: slice,
      ...(next ? { nextPageToken: next } : { nextSyncToken: `sync-${syncEpoch}.${version}` }),
    });
  }

  function handle(method: string, url: URL, raw: string, authorization: string | null): Response {
    const query = url.searchParams;
    const body = new URLSearchParams(raw);
    fake.requests.push({ method, path: url.pathname, query: Object.fromEntries(query) });
    const queued = failures.get(url.pathname)?.shift();
    if (queued) {
      return json(
        queued.status,
        { error: { errors: [{ reason: queued.reason ?? 'backendError' }] } },
        queued.retryAfter === undefined ? {} : { 'retry-after': String(queued.retryAfter) },
      );
    }
    if (method === 'POST' && url.pathname === '/token') return token(body);
    if (method === 'POST' && url.pathname === '/revoke') return revoke(body);
    const user = caller(authorization);
    if (!user) return json(401, { error: { errors: [{ reason: 'authError' }] } });
    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      const { slice, next } = page(
        [...user.calendars.values()].map((calendar) => calendar.entry),
        query,
      );
      return json(200, { items: slice, ...(next ? { nextPageToken: next } : {}) });
    }
    const match = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname);
    const single = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(url.pathname);
    if (method !== 'GET' && (match || single)) {
      if (!mayWrite(authorization)) {
        return json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } });
      }
      const calendarId = decodeURIComponent((match ?? single)![1]!);
      const eventId = single ? decodeURIComponent(single[2]!) : null;
      return write(user, method as FakeGoogleWrite['method'], { calendarId, eventId }, raw, query);
    }
    if (match) return events(user, decodeURIComponent(match[1]!), query);
    if (single) {
      const calendar = user.calendars.get(decodeURIComponent(single[1]!));
      const found = calendar?.events.get(decodeURIComponent(single[2]!));
      return found && found.event.status !== 'cancelled' ? json(200, found.event) : json(404, {});
    }
    return json(404, {});
  }

  return fake;
}
