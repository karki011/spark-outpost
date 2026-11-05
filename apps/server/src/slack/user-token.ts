import { z } from 'zod';
import { withTransaction, type Db } from '../persistence/db.ts';
import {
  markSlackNeedsSignIn,
  recordSlackRefresh,
  type SlackTokenTimes,
} from '../persistence/slack-sign-in.ts';
import {
  getSlackConnection,
  recordSlackEvent,
  type SlackConnectionRow,
} from '../persistence/slack.ts';
import { SLACK_SIGN_IN_SECRET, type SecretStore } from '../setup/secrets.ts';
import { refreshSlackTokens, type SlackUserTokens } from './oauth.ts';
import type { SlackSignInConfig } from './sign-in-config.ts';

const REFRESH_MARGIN_MS = 5 * 60_000;

export interface SlackTokenDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  slackApiUrl?: string | undefined;
  signIn?: SlackSignInConfig | null | undefined;
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

const clock = (deps: SlackTokenDeps) => deps.now?.() ?? Date.now();
const time = (iso: string | null) => (iso ? new Date(iso) : null);

export function slackTokenTimes(tokens: SlackUserTokens): SlackTokenTimes {
  return {
    accessExpiresAt: time(tokens.accessExpiresAt),
    refreshExpiresAt: time(tokens.refreshExpiresAt),
  };
}

function parseBundle(raw: string | null): SlackUserTokens | null {
  if (!raw) return null;
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readBundle(
  deps: SlackTokenDeps,
  generation: number,
  fresh = false,
): Promise<SlackUserTokens | null> {
  const stale = fresh || seenGeneration.get(deps.workspaceId) !== generation;
  const raw = await (
    stale ? deps.secrets.fresh(SLACK_SIGN_IN_SECRET) : deps.secrets.get(SLACK_SIGN_IN_SECRET)
  ).catch(() => null);
  seenGeneration.set(deps.workspaceId, generation);
  return parseBundle(raw);
}

export async function storeSlackSignInTokens(
  deps: SlackTokenDeps,
  tokens: SlackUserTokens,
): Promise<void> {
  await deps.secrets.set(SLACK_SIGN_IN_SECRET, JSON.stringify(tokens));
}

export async function savedSlackSignInToken(deps: SlackTokenDeps): Promise<string | null> {
  const raw = await deps.secrets.fresh(SLACK_SIGN_IN_SECRET).catch(() => null);
  return parseBundle(raw)?.accessToken ?? null;
}

export async function forgetSlackSignIn(deps: SlackTokenDeps): Promise<void> {
  seenGeneration.delete(deps.workspaceId);
  await deps.secrets.delete(SLACK_SIGN_IN_SECRET).catch(() => undefined);
}

function endsWithin(iso: string | null, now: number, marginMs: number): boolean {
  return iso !== null && Date.parse(iso) - now <= marginMs;
}

async function renew(deps: SlackTokenDeps, usedToken: string): Promise<string | null> {
  const config = deps.signIn;
  if (!config) return null;
  return withTransaction(deps.db, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `slack-sign-in:${deps.workspaceId}`,
    ]);
    const row = await getSlackConnection(client, deps.workspaceId);
    if (row?.method !== 'sign_in' || row.state !== 'connected') return null;
    const bundle = await readBundle(deps, row.generation, true);
    const now = clock(deps);
    const renewedElsewhere = bundle !== null && bundle.accessToken !== usedToken;
    if (renewedElsewhere && !endsWithin(bundle.accessExpiresAt, now, REFRESH_MARGIN_MS)) {
      return bundle.accessToken;
    }
    const answer = bundle?.refreshToken
      ? await refreshSlackTokens(deps, config, bundle.refreshToken, now)
      : ({ kind: 'rejected', code: 'no_refresh_token' } as const);
    if (answer.kind === 'rejected') {
      await markSlackNeedsSignIn(client, deps.workspaceId);
      await recordSlackEvent(client, deps.workspaceId, {
        action: 'refresh',
        outcome: 'failed',
        detail: { reason: answer.code },
      });
      return null;
    }
    await storeSlackSignInTokens(deps, answer.tokens);
    await recordSlackRefresh(client, deps.workspaceId, slackTokenTimes(answer.tokens));
    seenGeneration.set(deps.workspaceId, row.generation + 1);
    return answer.tokens.accessToken;
  });
}

export function refreshSlackSignInToken(
  deps: SlackTokenDeps,
  usedToken: string,
): Promise<string | null> {
  const running = refreshing.get(deps.workspaceId);
  if (running) return running;
  const started = renew(deps, usedToken).finally(() => refreshing.delete(deps.workspaceId));
  refreshing.set(deps.workspaceId, started);
  return started;
}

export async function slackSignInToken(
  deps: SlackTokenDeps,
  row: SlackConnectionRow,
): Promise<string | null> {
  if (row.method !== 'sign_in' || row.state !== 'connected') return null;
  const bundle = await readBundle(deps, row.generation);
  if (!bundle) {
    await markSlackNeedsSignIn(deps.db, deps.workspaceId);
    return null;
  }
  const now = clock(deps);
  if (!endsWithin(bundle.accessExpiresAt, now, REFRESH_MARGIN_MS)) return bundle.accessToken;
  try {
    return await refreshSlackSignInToken(deps, bundle.accessToken);
  } catch {
    return endsWithin(bundle.accessExpiresAt, now, 0) ? null : bundle.accessToken;
  }
}
