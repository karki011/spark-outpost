import type { IncomingMessage } from 'node:http';

export const APP_CLIENT_ID = 'Iv23liFakeClientId00';
export const APP_SLUG = 'spark-outpost-test';
export const APP_LOGIN = 'octo-app';
export const APP_USER_CODE = 'WDJB-MJHT';
export const APP_INSTALLATION = 4242;

type Decision = 'pending' | 'approved' | 'denied' | 'expired';

export interface FakeAnswer {
  status: number;
  body: unknown;
}

export interface FakeGitHubApp {
  decision: Decision;
  beforeDecision: ('authorization_pending' | 'slow_down')[];
  repos: string[];
  intervalSeconds: number;
  accessSeconds: number;
  rejectRefresh: boolean;
  deviceFlowDisabled: boolean;
  deviceCodes: number;
  polls: number;
  refreshes: number;
  issued: string[];
  revokeAccess(): void;
  loginFor(token: string): string | null;
  login(req: IncomingMessage, path: string): Promise<FakeAnswer | null>;
  installations(path: string, query: URLSearchParams): FakeAnswer | null;
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let text = '';
  for await (const chunk of req) text += String(chunk);
  return new URLSearchParams(text);
}

const ok = (body: unknown): FakeAnswer => ({ status: 200, body });
const REPOSITORIES = /^\/user\/installations\/(\d+)\/repositories$/;

export function fakeGitHubApp(): FakeGitHubApp {
  let deviceCode: string | null = null;
  let access: string | null = null;
  let refresh: string | null = null;

  function issue(app: FakeGitHubApp) {
    const serial = String(app.issued.length + 1).padStart(4, '0');
    access = `ghu_fakeAccess${serial}abcdefghijklmnopqrstuv`;
    refresh = `ghr_fakeRefresh${serial}abcdefghijklmnopqrstuv`;
    app.issued.push(access);
    return ok({
      access_token: access,
      expires_in: app.accessSeconds,
      refresh_token: refresh,
      refresh_token_expires_in: 15_897_600,
      token_type: 'bearer',
      scope: '',
    });
  }

  function poll(app: FakeGitHubApp, fields: URLSearchParams): FakeAnswer {
    app.polls += 1;
    if (fields.get('device_code') !== deviceCode) return ok({ error: 'incorrect_device_code' });
    const early = app.beforeDecision.shift();
    if (early === 'slow_down') {
      app.intervalSeconds += 1;
      return ok({ error: 'slow_down', interval: app.intervalSeconds });
    }
    if (early || app.decision === 'pending') return ok({ error: 'authorization_pending' });
    deviceCode = null;
    if (app.decision === 'denied') return ok({ error: 'access_denied' });
    if (app.decision === 'expired') return ok({ error: 'expired_token' });
    return issue(app);
  }

  function renew(app: FakeGitHubApp, fields: URLSearchParams): FakeAnswer {
    app.refreshes += 1;
    if (app.rejectRefresh || fields.get('refresh_token') !== refresh) {
      return ok({ error: 'bad_refresh_token' });
    }
    return issue(app);
  }

  const app: FakeGitHubApp = {
    decision: 'pending',
    beforeDecision: [],
    repos: ['acme/widgets'],
    intervalSeconds: 1,
    accessSeconds: 28_800,
    rejectRefresh: false,
    deviceFlowDisabled: false,
    deviceCodes: 0,
    polls: 0,
    refreshes: 0,
    issued: [],
    revokeAccess() {
      access = null;
    },
    loginFor: (token) => (access !== null && token === access ? APP_LOGIN : null),
    async login(req, path) {
      if (req.method !== 'POST') return null;
      if (path === '/login/device/code') {
        const fields = await form(req);
        if (fields.get('client_id') !== APP_CLIENT_ID) {
          return ok({ error: 'incorrect_client_credentials' });
        }
        if (app.deviceFlowDisabled) return ok({ error: 'device_flow_disabled' });
        app.deviceCodes += 1;
        deviceCode = `fake-device-code-${app.deviceCodes}`;
        return ok({
          device_code: deviceCode,
          user_code: APP_USER_CODE,
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: app.intervalSeconds,
        });
      }
      if (path !== '/login/oauth/access_token') return null;
      const fields = await form(req);
      if (fields.has('client_secret')) return ok({ error: 'unexpected_client_secret' });
      if (fields.get('client_id') !== APP_CLIENT_ID) {
        return ok({ error: 'incorrect_client_credentials' });
      }
      return fields.get('grant_type') === 'refresh_token' ? renew(app, fields) : poll(app, fields);
    },
    installations(path, query) {
      if (path === '/user/installations') {
        return ok({ total_count: 1, installations: [{ id: APP_INSTALLATION }] });
      }
      if (REPOSITORIES.exec(path)?.[1] !== String(APP_INSTALLATION)) return null;
      const size = Number(query.get('per_page') ?? 30);
      const start = (Number(query.get('page') ?? 1) - 1) * size;
      return ok({
        total_count: app.repos.length,
        repositories: app.repos.slice(start, start + size).map((name) => ({ full_name: name })),
      });
    },
  };
  return app;
}
