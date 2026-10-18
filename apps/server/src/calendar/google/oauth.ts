import { z } from 'zod';
import { GOOGLE_CALENDAR_SCOPES } from '@spark-outpost/contracts';
import type { Pkce } from '../../setup/pkce.ts';
import type { GoogleClientConfig } from './config.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const ID_TOKEN_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export type GoogleFailureKind = 'busy' | 'unreachable' | 'refused' | 'bad_response';

export class GoogleAuthError extends Error {
  readonly kind: GoogleFailureKind;

  constructor(kind: GoogleFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface GoogleOAuthDeps {
  fetch: typeof fetch;
  client: GoogleClientConfig;
}

export function googleAuthorizeUrl(
  client: GoogleClientConfig,
  pkce: Pkce,
  redirectUri: string,
  loginHint: string | null,
): string {
  const url = new URL(`${client.accountsUrl}/o/oauth2/v2/auth`);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(8).max(4096),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(8).max(4096).optional(),
  scope: z.string().max(2000).optional(),
  id_token: z.string().max(8192).optional(),
});

const refusalSchema = z.object({ error: z.string().min(1).max(200) });

const idClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1).max(255),
  email: z.string().min(3).max(320),
});

async function tokenRequest(deps: GoogleOAuthDeps, fields: Record<string, string>) {
  const body = new URLSearchParams({ client_id: deps.client.clientId, ...fields });
  if (deps.client.clientSecret) body.set('client_secret', deps.client.clientSecret);
  let response: Response;
  try {
    response = await deps.fetch(`${deps.client.oauthUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GoogleAuthError('unreachable', 'Couldn’t reach Google. Check your connection.');
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GoogleAuthError('busy', 'Google is busy right now. Spark tries again shortly.');
  }
  const data = (await response.json().catch(() => null)) as unknown;
  return { ok: response.ok, data };
}

function claimsOf(idToken: string | undefined, clientId: string) {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try {
    const parsed = idClaimsSchema.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    if (!parsed.success) return null;
    const claims = parsed.data;
    if (!ID_TOKEN_ISSUERS.has(claims.iss) || claims.aud !== clientId) return null;
    return claims;
  } catch {
    return null;
  }
}

export interface GoogleGrant {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  subject: string;
  email: string;
  scopes: string[];
}

function refusedMessage(code: string): string {
  if (code === 'invalid_grant') {
    return 'Google refused that sign-in code. It may have run out. Start again.';
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return 'Google doesn’t accept this build’s client ID. Check the Google OAuth client.';
  }
  return `Google refused the sign-in (${code.slice(0, 60)}).`;
}

export async function exchangeGoogleCode(
  deps: GoogleOAuthDeps,
  code: { code: string; verifier: string; redirectUri: string },
  now: number,
): Promise<GoogleGrant> {
  const { ok, data } = await tokenRequest(deps, {
    grant_type: 'authorization_code',
    code: code.code,
    code_verifier: code.verifier,
    redirect_uri: code.redirectUri,
  });
  if (!ok) {
    const refused = refusalSchema.safeParse(data);
    throw new GoogleAuthError(
      'refused',
      refusedMessage(refused.success ? refused.data.error : 'unknown'),
    );
  }
  const parsed = tokenSchema.safeParse(data);
  const claims = parsed.success ? claimsOf(parsed.data.id_token, deps.client.clientId) : null;
  if (!parsed.success || !claims || !parsed.data.refresh_token) {
    throw new GoogleAuthError('bad_response', 'Google sent an unexpected answer while signing in.');
  }
  return {
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
    expiresAt: now + parsed.data.expires_in * 1000,
    subject: claims.sub,
    email: claims.email,
    scopes: (parsed.data.scope ?? '').split(' ').filter(Boolean),
  };
}

export type GoogleRefresh =
  { kind: 'tokens'; accessToken: string; expiresAt: number } | { kind: 'rejected' };

export async function refreshGoogleAccess(
  deps: GoogleOAuthDeps,
  refreshToken: string,
  now: number,
): Promise<GoogleRefresh> {
  const { ok, data } = await tokenRequest(deps, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (!ok) {
    const refused = refusalSchema.safeParse(data);
    if (refused.success && refused.data.error === 'invalid_grant') return { kind: 'rejected' };
    throw new GoogleAuthError('refused', 'Google refused to renew the sign-in.');
  }
  const parsed = tokenSchema.safeParse(data);
  if (!parsed.success) {
    throw new GoogleAuthError('bad_response', 'Google sent an unexpected answer.');
  }
  return {
    kind: 'tokens',
    accessToken: parsed.data.access_token,
    expiresAt: now + parsed.data.expires_in * 1000,
  };
}

export async function revokeGoogleToken(deps: GoogleOAuthDeps, token: string): Promise<boolean> {
  try {
    const response = await deps.fetch(`${deps.client.oauthUrl}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}
