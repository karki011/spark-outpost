import { z } from 'zod';
import { withTransaction, type Db } from '../../persistence/db.ts';
import {
  appConnection,
  markAppNeedsSignIn,
  recordAppRefresh,
  type TokenTimes,
} from '../../persistence/github-app.ts';
import type { SecretStore } from '../../setup/secrets.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { refreshTokens, type AppTokens } from './app-oauth.ts';
import { GitHubApiError, type GitHubRequest } from './connection.ts';
import { honouringRateLimit, type RateLimit } from './rate-limit.ts';
import { tokenRequest } from './transports.ts';

const REFRESH_MARGIN_MS = 5 * 60_000;
export const SIGN_IN_AGAIN = 'Your GitHub sign-in ended. Sign in again in Settings → Connectors.';

export interface AppTokenDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  app?: GitHubAppConfig | null | undefined;
  now?: (() => number) | undefined;
}

const bundleSchema = z.object({
  accessToken: z.string().min(1),
  accessExpiresAt: z.string().nullable(),
  refreshToken: z.string().nullable(),
  refreshExpiresAt: z.string().nullable(),
});

const seenGeneration = new Map<string, number>();
const refreshing = new Map<string, Promise<string | null>>();
const rateLimits = new Map<string, RateLimit>();

const clock = (deps: AppTokenDeps) => deps.now?.() ?? Date.now();
const time = (iso: string | null) => (iso ? new Date(iso) : null);

export function tokenTimes(tokens: AppTokens): TokenTimes {
  return {
    accessExpiresAt: time(tokens.accessExpiresAt),
    refreshExpiresAt: time(tokens.refreshExpiresAt),
  };
}

function parseBundle(raw: string | null): AppTokens | null {
  if (!raw) return null;
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readBundle(
  deps: AppTokenDeps,
  generation: number,
  fresh = false,
): Promise<AppTokens | null> {
  const stale = fresh || seenGeneration.get(deps.workspaceId) !== generation;
  const raw = await (
    stale ? deps.secrets.fresh('github-app') : deps.secrets.get('github-app')
  ).catch(() => null);
  seenGeneration.set(deps.workspaceId, generation);
  return parseBundle(raw);
}

export async function storeAppTokens(deps: AppTokenDeps, tokens: AppTokens): Promise<void> {
  await deps.secrets.set('github-app', JSON.stringify(tokens));
}

export async function appTokensSaved(deps: AppTokenDeps): Promise<boolean> {
  return parseBundle(await deps.secrets.get('github-app').catch(() => null)) !== null;
}

function endsWithin(iso: string | null, now: number, marginMs: number): boolean {
  return iso !== null && Date.parse(iso) - now <= marginMs;
}

async function renew(deps: AppTokenDeps, usedToken: string): Promise<string | null> {
  const app = deps.app;
  if (!app) return null;
  return withTransaction(deps.db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `github-app:${deps.workspaceId}`,
    ]);
    const row = await appConnection(client, deps.workspaceId);
    if (row?.state !== 'connected') return null;
    const bundle = await readBundle(deps, row.generation, true);
    if (!bundle) return null;
    const now = clock(deps);
    const renewedElsewhere = bundle.accessToken !== usedToken;
    if (renewedElsewhere && !endsWithin(bundle.accessExpiresAt, now, REFRESH_MARGIN_MS)) {
      return bundle.accessToken;
    }
    const answer =
      bundle.refreshToken && !endsWithin(bundle.refreshExpiresAt, now, 0)
        ? await refreshTokens(app, deps.fetch, bundle.refreshToken, now)
        : ({ kind: 'rejected' } as const);
    if (answer.kind === 'rejected') {
      await markAppNeedsSignIn(client, deps.workspaceId);
      return null;
    }
    await storeAppTokens(deps, answer.tokens);
    await recordAppRefresh(client, deps.workspaceId, tokenTimes(answer.tokens));
    seenGeneration.set(deps.workspaceId, row.generation + 1);
    return answer.tokens.accessToken;
  });
}

export function refreshAppToken(deps: AppTokenDeps, usedToken: string): Promise<string | null> {
  const running = refreshing.get(deps.workspaceId);
  if (running) return running;
  const started = renew(deps, usedToken).finally(() => refreshing.delete(deps.workspaceId));
  refreshing.set(deps.workspaceId, started);
  return started;
}

export async function appAccessToken(deps: AppTokenDeps): Promise<string | null> {
  if (!deps.app) return null;
  const row = await appConnection(deps.db, deps.workspaceId);
  if (row?.state !== 'connected') return null;
  const bundle = await readBundle(deps, row.generation);
  if (!bundle) return null;
  const now = clock(deps);
  if (!endsWithin(bundle.accessExpiresAt, now, REFRESH_MARGIN_MS)) return bundle.accessToken;
  try {
    return await refreshAppToken(deps, bundle.accessToken);
  } catch {
    return endsWithin(bundle.accessExpiresAt, now, 0) ? null : bundle.accessToken;
  }
}

function rateLimitFor(workspaceId: string): RateLimit {
  const known = rateLimits.get(workspaceId);
  if (known) return known;
  const limit = { until: 0 };
  rateLimits.set(workspaceId, limit);
  return limit;
}

export function forgetAppTokens(workspaceId: string): void {
  seenGeneration.delete(workspaceId);
  rateLimits.delete(workspaceId);
}

export function appRequest(deps: AppTokenDeps, apiBase: string): GitHubRequest {
  const send = (token: string) => tokenRequest(apiBase, token, deps.fetch);
  const request: GitHubRequest = async (method, path, body) => {
    const token = await appAccessToken(deps);
    if (!token) throw new GitHubApiError(401, SIGN_IN_AGAIN);
    const first = await send(token)(method, path, body);
    if (first.status !== 401) return first;
    const renewed = await refreshAppToken(deps, token).catch(() => null);
    return renewed ? send(renewed)(method, path, body) : first;
  };
  return honouringRateLimit(request, rateLimitFor(deps.workspaceId), () => clock(deps));
}
