import { createHash } from 'node:crypto';

export const SLACK_CLIENT_ID = '1234567890.9876543210';
export const SLACK_SIGN_IN_ACCESS = 'xoxe.xoxp-1-fakesigninaccess';
export const SLACK_SIGN_IN_REFRESH = 'xoxe-1-fakesigninrefresh';

interface IssuedCode {
  challenge: string;
  redirectUri: string;
  scopes: string[];
  used: boolean;
}

export interface FakeSlackOAuth {
  access: string | null;
  refresh: string | null;
  scopes: string[];
  requests: Record<string, string>[];
  refreshes: number;
  revoked: string[];
  expiresIn: number;
  failRefresh: string | null;
  refreshDelayMs: number;
  deny: string | null;
  authorize(authorizeUrl: string): string;
  grant(form: URLSearchParams): Promise<Record<string, unknown>>;
  revoke(token: string): void;
}

const refused = (error: string) => ({ ok: false, error });

export function fakeSlackOAuth(user: { id: string; teamId: string; team: string }): FakeSlackOAuth {
  const codes = new Map<string, IssuedCode>();
  let issued = 0;

  function issue(scopes: string[]) {
    issued += 1;
    oauth.access = `${SLACK_SIGN_IN_ACCESS}${issued}`;
    oauth.refresh = `${SLACK_SIGN_IN_REFRESH}${issued}`;
    oauth.scopes = scopes;
    return {
      access_token: oauth.access,
      refresh_token: oauth.refresh,
      token_type: 'user',
      expires_in: oauth.expiresIn,
      scope: scopes.join(','),
    };
  }

  function exchange(form: URLSearchParams) {
    const code = codes.get(form.get('code') ?? '');
    if (!code || code.used) return refused('invalid_code');
    code.used = true;
    if (form.get('redirect_uri') !== code.redirectUri) return refused('bad_redirect_uri');
    const challenge = createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url');
    if (challenge !== code.challenge) return refused('invalid_code_verifier');
    return {
      ok: true,
      app_id: 'A0SPARK',
      authed_user: { id: user.id, ...issue([...new Set([...oauth.scopes, ...code.scopes])]) },
      team: { id: user.teamId, name: user.team },
    };
  }

  async function renew(form: URLSearchParams) {
    if (oauth.refreshDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, oauth.refreshDelayMs));
    }
    if (oauth.failRefresh) return refused(oauth.failRefresh);
    if (!oauth.refresh || form.get('refresh_token') !== oauth.refresh) {
      return refused('invalid_refresh_token');
    }
    oauth.refreshes += 1;
    return { ok: true, user_id: user.id, team: { id: user.teamId }, ...issue(oauth.scopes) };
  }

  const oauth: FakeSlackOAuth = {
    access: null,
    refresh: null,
    scopes: [],
    requests: [],
    refreshes: 0,
    revoked: [],
    expiresIn: 43_200,
    failRefresh: null,
    refreshDelayMs: 0,
    deny: null,
    authorize(authorizeUrl) {
      const query = new URL(authorizeUrl).searchParams;
      const redirect = new URL(query.get('redirect_uri') ?? '');
      redirect.searchParams.set('state', query.get('state') ?? '');
      const problem =
        oauth.deny ??
        (query.get('client_id') !== SLACK_CLIENT_ID ? 'invalid_client_id' : null) ??
        (query.get('scope') ? 'invalid_scope' : null) ??
        (query.get('code_challenge_method') !== 'S256' ? 'invalid_request' : null);
      if (problem) {
        redirect.searchParams.set('error', problem);
        return redirect.toString();
      }
      const code = `code-${codes.size + 1}-${Math.random().toString(36).slice(2, 10)}`;
      codes.set(code, {
        challenge: query.get('code_challenge') ?? '',
        redirectUri: query.get('redirect_uri') ?? '',
        scopes: (query.get('user_scope') ?? '').split(',').filter(Boolean),
        used: false,
      });
      redirect.searchParams.set('code', code);
      return redirect.toString();
    },
    async grant(form) {
      oauth.requests.push(Object.fromEntries(form));
      if (form.has('client_secret')) return refused('bad_client_secret');
      if (form.get('client_id') !== SLACK_CLIENT_ID) return refused('invalid_client_id');
      return form.get('grant_type') === 'refresh_token' ? renew(form) : exchange(form);
    },
    revoke(token) {
      oauth.revoked.push(token);
      if (token === oauth.access) oauth.access = null;
    },
  };
  return oauth;
}
