export const FAKE_ZOOM_CLIENT_ID = 'FakeZoomPublicClient01';

export interface FakeZoom {
  baseUrl: string;
  fetch: typeof fetch;
  requests: { method: string; path: string; body: Record<string, unknown> | null }[];
  meetings: Map<string, { topic: string; start_time: string; duration: number }>;
  refreshTokens: string[];
  revoked: string[];
  code(): string;
  expireAccess(): void;
  rejectRefresh(): void;
  refreshStatus: number | null;
  holdTokens: Promise<void> | null;
  failNextCreate(status: number): void;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export function fakeZoom(baseUrl = 'https://zoom.test'): FakeZoom {
  let issued = 0;
  let nextMeeting = 8_100_000_000;
  let access = new Set<string>();
  let refresh: string | null = null;
  let rejecting = false;
  let failCreate: number | null = null;
  const codes = new Set<string>();

  const issue = () => {
    issued += 1;
    const accessToken = `zoom-access-${issued}`;
    refresh = `zoom-refresh-${issued}`;
    access = new Set([accessToken]);
    fake.refreshTokens.push(refresh);
    return json(200, { access_token: accessToken, refresh_token: refresh, expires_in: 3600 });
  };

  const token = (form: URLSearchParams) => {
    if (form.get('client_id') !== FAKE_ZOOM_CLIENT_ID)
      return json(400, { error: 'invalid_client' });
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '';
      if (!codes.delete(code) || !form.get('code_verifier')) {
        return json(400, { error: 'invalid_grant' });
      }
      return issue();
    }
    if (fake.refreshStatus !== null) return json(fake.refreshStatus, {});
    if (rejecting || form.get('refresh_token') !== refresh) {
      return json(400, { error: 'invalid_grant' });
    }
    return issue();
  };

  const api = (method: string, path: string, body: Record<string, unknown> | null) => {
    if (method === 'GET' && path === '/v2/users/me') {
      return json(200, { id: 'zoom-user-1', email: 'me@example.com' });
    }
    if (method === 'POST' && path === '/v2/users/me/meetings') {
      if (failCreate !== null) {
        const status = failCreate;
        failCreate = null;
        return json(status, { code: status });
      }
      nextMeeting += 1;
      const id = String(nextMeeting);
      fake.meetings.set(id, body as { topic: string; start_time: string; duration: number });
      return json(201, { id: nextMeeting, join_url: `https://acme.zoom.us/j/${id}` });
    }
    const meeting = /^\/v2\/meetings\/(\d+)$/.exec(path);
    if (method === 'DELETE' && meeting) {
      return fake.meetings.delete(meeting[1]!)
        ? new Response(null, { status: 204 })
        : json(404, {});
    }
    return json(404, {});
  };

  const fake: FakeZoom = {
    baseUrl,
    requests: [],
    meetings: new Map(),
    refreshTokens: [],
    revoked: [],
    refreshStatus: null,
    holdTokens: null,
    code() {
      const code = `zoom-code-${codes.size + issued + 1}`;
      codes.add(code);
      return code;
    },
    expireAccess: () => {
      access = new Set();
    },
    rejectRefresh: () => {
      rejecting = true;
    },
    failNextCreate: (status) => {
      failCreate = status;
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const method = init?.method ?? 'GET';
      const path = url.pathname;
      if (path === '/oauth/token' && fake.holdTokens) await fake.holdTokens;
      if (path === '/oauth/token') return token(new URLSearchParams(String(init?.body)));
      if (path === '/oauth/revoke') {
        const form = new URLSearchParams(String(init?.body));
        fake.revoked.push(form.get('token') ?? '');
        return json(200, { status: 'success' });
      }
      const bearer = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      fake.requests.push({ method, path, body });
      if (!access.has(bearer)) return json(401, { code: 124 });
      return api(method, path, body);
    }) as typeof fetch,
  };
  return fake;
}
