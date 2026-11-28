import { z } from 'zod';
import type { CloudflareSharePermission } from '@spark-outpost/contracts';
import type { Pkce } from '../setup/pkce.ts';
import type { CloudflareClientConfig } from './client.ts';

const REQUEST_TIMEOUT_MS = 20_000;

export const CLOUDFLARE_SCOPES: Record<CloudflareSharePermission, string> = {
  account: 'account-settings.read',
  storage: 'workers-r2.write',
  workers: 'workers-scripts.admin',
};

export interface CloudflareOAuthDeps {
  fetch: typeof fetch;
  client: CloudflareClientConfig;
}

export class CloudflareSignInError extends Error {}

export function cloudflareAuthorizeUrl(
  client: CloudflareClientConfig,
  pkce: Pkce,
  redirectUri: string,
  scopes: string[] = Object.values(CLOUDFLARE_SCOPES),
): string {
  const url = new URL(`${client.oauthUrl}/auth`);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', scopes.join(' '));
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(8).max(8192),
  expires_in: z.number().int().positive(),
  scope: z.string().max(8192).default(''),
});

export interface CloudflareToken {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

export async function exchangeCloudflareCode(
  deps: CloudflareOAuthDeps,
  code: { code: string; verifier: string; redirectUri: string },
  now: number,
): Promise<CloudflareToken> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.client.oauthUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: deps.client.clientId,
        code: code.code,
        code_verifier: code.verifier,
        redirect_uri: code.redirectUri,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CloudflareSignInError('Spark couldn’t reach Cloudflare. Check your connection.');
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!response.ok || !parsed.success) {
    throw new CloudflareSignInError('Cloudflare refused that sign-in. Start again.');
  }
  return {
    accessToken: parsed.data.access_token,
    expiresAt: now + parsed.data.expires_in * 1000,
    scopes: parsed.data.scope.split(/\s+/).filter(Boolean),
  };
}

export async function revokeCloudflareToken(
  deps: CloudflareOAuthDeps,
  accessToken: string,
): Promise<boolean> {
  try {
    const response = await deps.fetch(`${deps.client.oauthUrl}/revoke`, {
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
