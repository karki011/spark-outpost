import { z } from 'zod';
import type { Pkce } from '../setup/pkce.ts';
import type { ZoomClientConfig } from './config.ts';

const REQUEST_TIMEOUT_MS = 20_000;

export type ZoomFailureKind = 'busy' | 'unreachable' | 'refused' | 'bad_response';

export class ZoomError extends Error {
  readonly kind: ZoomFailureKind;

  constructor(kind: ZoomFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

export interface ZoomDeps {
  fetch: typeof fetch;
  client: ZoomClientConfig;
}

export function zoomAuthorizeUrl(client: ZoomClientConfig, pkce: Pkce, redirectUri: string) {
  const url = new URL(`${client.oauthUrl}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(8).max(8192),
  refresh_token: z.string().min(8).max(8192),
  expires_in: z.number().int().positive(),
});

export interface ZoomTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function tokenRequest(deps: ZoomDeps, fields: Record<string, string>) {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.client.oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: deps.client.clientId, ...fields }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ZoomError('unreachable', 'Couldn’t reach Zoom. Check your connection.');
  }
  if (response.status === 429 || response.status >= 500) {
    throw new ZoomError('busy', 'Zoom is busy right now. Try again shortly.');
  }
  const data = (await response.json().catch(() => null)) as unknown;
  return { ok: response.ok, status: response.status, data };
}

function tokensOf(data: unknown, now: number): ZoomTokens {
  const parsed = tokenSchema.safeParse(data);
  if (!parsed.success) throw new ZoomError('bad_response', 'Zoom sent an unexpected answer.');
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: now + parsed.data.expires_in * 1000,
  };
}

export async function exchangeZoomCode(
  deps: ZoomDeps,
  code: { code: string; verifier: string; redirectUri: string },
  now: number,
): Promise<ZoomTokens> {
  const { ok, data } = await tokenRequest(deps, {
    grant_type: 'authorization_code',
    code: code.code,
    code_verifier: code.verifier,
    redirect_uri: code.redirectUri,
  });
  if (!ok) throw new ZoomError('refused', 'Zoom refused that sign-in. Start again.');
  return tokensOf(data, now);
}

export type ZoomRefresh = ({ kind: 'tokens' } & ZoomTokens) | { kind: 'rejected' };

export async function refreshZoomTokens(
  deps: ZoomDeps,
  refreshToken: string,
  now: number,
): Promise<ZoomRefresh> {
  const { ok, status, data } = await tokenRequest(deps, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (status === 400 || status === 401) return { kind: 'rejected' };
  if (!ok) throw new ZoomError('refused', `Zoom refused to renew the sign-in (${status}).`);
  return { kind: 'tokens', ...tokensOf(data, now) };
}

export async function revokeZoomToken(deps: ZoomDeps, accessToken: string): Promise<boolean> {
  try {
    const response = await deps.fetch(`${deps.client.oauthUrl}/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: accessToken, client_id: deps.client.clientId }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
