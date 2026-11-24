import { z } from 'zod';

import type { Pkce } from '../../setup/pkce.ts';
import { MICROSOFT_TENANT, type MicrosoftClientConfig } from './config.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const ISSUER = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;
const REJECTED_REFRESH = new Set(['invalid_grant', 'interaction_required', 'consent_required']);

export type MicrosoftFailureKind = 'busy' | 'unreachable' | 'refused' | 'bad_response';

export class MicrosoftAuthError extends Error {
  readonly kind: MicrosoftFailureKind;

  constructor(kind: MicrosoftFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface MicrosoftOAuthDeps {
  fetch: typeof fetch;
  client: MicrosoftClientConfig;
}

const endpoint = (client: MicrosoftClientConfig, name: 'authorize' | 'token') =>
  `${client.loginUrl}/${MICROSOFT_TENANT}/oauth2/v2.0/${name}`;

export function microsoftAuthorizeUrl(
  client: MicrosoftClientConfig,
  pkce: Pkce,
  redirectUri: string,
  request: { scopes: readonly string[]; loginHint: string | null },
): string {
  const url = new URL(endpoint(client, 'authorize'));
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', request.scopes.join(' '));
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (request.loginHint) url.searchParams.set('login_hint', request.loginHint);
  else url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(8).max(16_384),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(8).max(16_384).optional(),
  scope: z.string().max(4000).optional(),
  id_token: z.string().max(16_384).optional(),
});

const refusalSchema = z.object({ error: z.string().min(1).max(200) });

const idClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  oid: z.string().min(1).max(255),
  email: z.string().min(3).max(320).optional(),
  preferred_username: z.string().min(3).max(320).optional(),
});

async function tokenRequest(deps: MicrosoftOAuthDeps, fields: Record<string, string>) {
  const body = new URLSearchParams({ client_id: deps.client.clientId, ...fields });
  let response: Response;
  try {
    response = await deps.fetch(endpoint(deps.client, 'token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MicrosoftAuthError('unreachable', 'Couldn’t reach Microsoft. Check your connection.');
  }
  if (response.status === 429 || response.status >= 500) {
    throw new MicrosoftAuthError('busy', 'Microsoft is busy right now. Spark tries again shortly.');
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
    if (!ISSUER.test(claims.iss) || claims.aud !== clientId) return null;
    return claims;
  } catch {
    return null;
  }
}

export interface MicrosoftGrant {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
  subject: string;
  email: string | null;
  scopes: string[];
}

function refusedMessage(code: string): string {
  if (code === 'invalid_grant') {
    return 'Microsoft refused that sign-in code. It may have run out. Start again.';
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    return 'Microsoft doesn’t accept this build’s client ID. Check the Microsoft app registration.';
  }
  return `Microsoft refused the sign-in (${code.slice(0, 60)}).`;
}

export async function exchangeMicrosoftCode(
  deps: MicrosoftOAuthDeps,
  code: { code: string; verifier: string; redirectUri: string; scopes: readonly string[] },
  now: number,
): Promise<MicrosoftGrant> {
  const { ok, data } = await tokenRequest(deps, {
    grant_type: 'authorization_code',
    code: code.code,
    code_verifier: code.verifier,
    redirect_uri: code.redirectUri,
    scope: code.scopes.join(' '),
  });
  if (!ok) {
    const refused = refusalSchema.safeParse(data);
    throw new MicrosoftAuthError(
      'refused',
      refusedMessage(refused.success ? refused.data.error : 'unknown'),
    );
  }
  const parsed = tokenSchema.safeParse(data);
  const claims = parsed.success ? claimsOf(parsed.data.id_token, deps.client.clientId) : null;
  if (!parsed.success || !claims || !parsed.data.refresh_token) {
    throw new MicrosoftAuthError(
      'bad_response',
      'Microsoft sent an unexpected answer while signing in.',
    );
  }
  return {
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
    expiresAt: now + parsed.data.expires_in * 1000,
    subject: claims.oid,
    email: claims.email ?? claims.preferred_username ?? null,
    scopes: (parsed.data.scope ?? '').split(' ').filter(Boolean),
  };
}

export type MicrosoftRefresh =
  | { kind: 'tokens'; accessToken: string; expiresAt: number; refreshToken: string | null }
  | { kind: 'rejected' };

export async function refreshMicrosoftAccess(
  deps: MicrosoftOAuthDeps,
  request: { refreshToken: string; scopes: readonly string[] },
  now: number,
): Promise<MicrosoftRefresh> {
  const { ok, data } = await tokenRequest(deps, {
    grant_type: 'refresh_token',
    refresh_token: request.refreshToken,
    scope: request.scopes.join(' '),
  });
  if (!ok) {
    const refused = refusalSchema.safeParse(data);
    if (refused.success && REJECTED_REFRESH.has(refused.data.error)) return { kind: 'rejected' };
    throw new MicrosoftAuthError('refused', 'Microsoft refused to renew the sign-in.');
  }
  const parsed = tokenSchema.safeParse(data);
  if (!parsed.success) {
    throw new MicrosoftAuthError('bad_response', 'Microsoft sent an unexpected answer.');
  }
  return {
    kind: 'tokens',
    accessToken: parsed.data.access_token,
    expiresAt: now + parsed.data.expires_in * 1000,
    refreshToken: parsed.data.refresh_token ?? null,
  };
}
