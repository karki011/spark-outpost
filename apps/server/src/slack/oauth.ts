import { z } from 'zod';
import { SLACK_AUTHORIZE_URL } from '@spark-outpost/contracts';
import type { Pkce } from '../setup/pkce.ts';
import type { SlackSignInConfig } from './sign-in-config.ts';
import { SLACK_API_URL, SlackApiError } from './web-api.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60_000;

export interface SlackOAuthDeps {
  fetch: typeof fetch;
  slackApiUrl?: string | undefined;
}

export interface SlackUserTokens {
  accessToken: string;
  accessExpiresAt: string | null;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
}

export function slackAuthorizeUrl(
  config: SlackSignInConfig,
  pkce: Pkce,
  userScopes: readonly string[],
): string {
  const url = new URL(SLACK_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('user_scope', userScopes.join(','));
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', pkce.state);
  url.searchParams.set('code_challenge', pkce.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const token = z.string().min(8).max(1000);

const grantSchema = z.object({
  access_token: token,
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: token.optional(),
  scope: z.string().optional(),
});

const exchangeSchema = z.object({
  ok: z.literal(true),
  authed_user: grantSchema.extend({ id: z.string().min(1).max(40) }),
  team: z.object({ id: z.string().min(1).max(40) }).nullish(),
});

const refreshSchema = z.union([
  z.object({ ok: z.literal(true), authed_user: grantSchema }).transform((data) => data.authed_user),
  grantSchema.extend({ ok: z.literal(true) }),
]);

const refusedSchema = z.object({ ok: z.literal(false), error: z.string().min(1) });

const TRANSIENT = new Set([
  'ratelimited',
  'internal_error',
  'fatal_error',
  'service_unavailable',
  'request_timeout',
]);

const UNEXPECTED = 'Slack sent an unexpected answer while signing in.';

function exchangeFailure(code: string, config: SlackSignInConfig): string {
  if (code === 'invalid_code' || code === 'code_already_used') {
    return 'Slack refused that sign-in code. It may have been used already or run out. Start again.';
  }
  if (code === 'bad_redirect_uri') {
    return `Slack doesn't know this build's redirect address. The Slack app needs ${config.redirectUri} as a redirect URL.`;
  }
  if (code === 'invalid_client_id' || code === 'bad_client_secret' || code === 'pkce_not_allowed') {
    return "Slack doesn't accept this build's client ID for sign-in. Check SPARK_SLACK_CLIENT_ID and that PKCE is on in the Slack app.";
  }
  return `Slack refused the sign-in (${code.slice(0, 60)}).`;
}

async function grant(deps: SlackOAuthDeps, fields: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.slackApiUrl ?? SLACK_API_URL}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SlackApiError('unreachable', "Couldn't reach Slack. Check your connection.");
  }
  if (response.status === 429 || response.status >= 500) {
    throw new SlackApiError('busy', 'Slack is busy right now. Try again in a minute.');
  }
  const data = (await response.json().catch(() => null)) as unknown;
  if (!data || typeof data !== 'object') throw new SlackApiError('bad_response', UNEXPECTED);
  return data;
}

function tokensOf(found: z.infer<typeof grantSchema>, now: number): SlackUserTokens | null {
  if (found.token_type !== undefined && found.token_type !== 'user') return null;
  const rotating = found.refresh_token !== undefined;
  return {
    accessToken: found.access_token,
    accessExpiresAt:
      found.expires_in === undefined ? null : new Date(now + found.expires_in * 1000).toISOString(),
    refreshToken: found.refresh_token ?? null,
    refreshExpiresAt: rotating ? new Date(now + REFRESH_TOKEN_LIFETIME_MS).toISOString() : null,
  };
}

const scopeList = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

export interface SlackExchange {
  tokens: SlackUserTokens;
  userId: string;
  teamId: string | null;
  scopes: string[];
}

export async function exchangeSlackCode(
  deps: SlackOAuthDeps,
  config: SlackSignInConfig,
  code: { code: string; verifier: string },
  now: number,
): Promise<SlackExchange> {
  const data = await grant(deps, {
    client_id: config.clientId,
    code: code.code,
    code_verifier: code.verifier,
    redirect_uri: config.redirectUri,
  });
  const refused = refusedSchema.safeParse(data);
  if (refused.success) {
    throw new SlackApiError('sign_in_refused', exchangeFailure(refused.data.error, config));
  }
  const parsed = exchangeSchema.safeParse(data);
  const tokens = parsed.success ? tokensOf(parsed.data.authed_user, now) : null;
  if (!parsed.success || !tokens) throw new SlackApiError('bad_response', UNEXPECTED);
  return {
    tokens,
    userId: parsed.data.authed_user.id,
    teamId: parsed.data.team?.id ?? null,
    scopes: scopeList(parsed.data.authed_user.scope),
  };
}

export type SlackRefreshAnswer =
  { kind: 'tokens'; tokens: SlackUserTokens } | { kind: 'rejected'; code: string };

export async function refreshSlackTokens(
  deps: SlackOAuthDeps,
  config: SlackSignInConfig,
  refreshToken: string,
  now: number,
): Promise<SlackRefreshAnswer> {
  const data = await grant(deps, {
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const refused = refusedSchema.safeParse(data);
  if (refused.success) {
    if (TRANSIENT.has(refused.data.error)) {
      throw new SlackApiError('busy', 'Slack is busy right now. Try again in a minute.');
    }
    return { kind: 'rejected', code: refused.data.error.slice(0, 60) };
  }
  const parsed = refreshSchema.safeParse(data);
  const tokens = parsed.success ? tokensOf(parsed.data, now) : null;
  if (!tokens) throw new SlackApiError('bad_response', UNEXPECTED);
  return { kind: 'tokens', tokens };
}
