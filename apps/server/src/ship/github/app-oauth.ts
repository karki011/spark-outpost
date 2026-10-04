import { z } from 'zod';
import { GITHUB_APP_HOST, type GitHubAppConfig } from './app-config.ts';
import { GitHubApiError } from './connection.ts';

const REQUEST_TIMEOUT_MS = 20_000;
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const DEFAULT_POLL_SECONDS = 5;
export const SLOW_DOWN_SECONDS = 5;

export interface AppTokens {
  accessToken: string;
  accessExpiresAt: string | null;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
}

export type PollAnswer =
  | { kind: 'tokens'; tokens: AppTokens }
  | { kind: 'pending' }
  | { kind: 'slow_down'; intervalSeconds: number | null }
  | { kind: 'expired' }
  | { kind: 'denied' }
  | { kind: 'failed'; message: string };

export type RefreshAnswer = { kind: 'tokens'; tokens: AppTokens } | { kind: 'rejected' };

function onGitHub(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === GITHUB_APP_HOST;
  } catch {
    return false;
  }
}

const deviceCodeSchema = z.object({
  device_code: z.string().min(8).max(200),
  user_code: z
    .string()
    .min(4)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/),
  verification_uri: z.string().refine(onGitHub),
  expires_in: z.number().int().positive().max(86_400),
  interval: z.number().int().nonnegative().max(3600).default(DEFAULT_POLL_SECONDS),
});

const errorSchema = z.object({
  error: z.string().min(1),
  interval: z.number().int().positive().max(3600).optional(),
});

const tokensSchema = z.object({
  access_token: z.string().min(8).max(400),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(8).max(400).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

const FAILURES: Record<string, string> = {
  device_flow_disabled:
    'This GitHub App has device flow turned off. Turn on “Enable Device Flow” in the app’s settings on GitHub.',
  incorrect_client_credentials:
    'GitHub does not know this app’s client ID. Check SPARK_GITHUB_APP_CLIENT_ID.',
};

const UNEXPECTED = 'GitHub sent an unexpected answer while signing in.';

function failureMessage(code: string): string {
  return FAILURES[code] ?? `GitHub refused the sign-in (${code.slice(0, 60)}).`;
}

async function postForm(
  app: GitHubAppConfig,
  fetchImpl: typeof fetch,
  path: string,
  fields: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${app.loginUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Spark-Outpost',
      },
      body: new URLSearchParams(fields).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GitHubApiError(0, "Couldn't reach GitHub. Check your connection, then try again.");
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GitHubApiError(response.status, 'GitHub is busy right now. Try again in a minute.');
  }
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    throw new GitHubApiError(502, UNEXPECTED);
  }
}

function inSeconds(now: number, seconds: number | undefined): string | null {
  return seconds === undefined ? null : new Date(now + seconds * 1000).toISOString();
}

function tokensOf(data: unknown, now: number): AppTokens | null {
  const parsed = tokensSchema.safeParse(data);
  if (!parsed.success) return null;
  return {
    accessToken: parsed.data.access_token,
    accessExpiresAt: inSeconds(now, parsed.data.expires_in),
    refreshToken: parsed.data.refresh_token ?? null,
    refreshExpiresAt: inSeconds(now, parsed.data.refresh_token_expires_in),
  };
}

export async function requestDeviceCode(
  app: GitHubAppConfig,
  fetchImpl: typeof fetch,
  now: number,
): Promise<DeviceCode> {
  const data = await postForm(app, fetchImpl, '/login/device/code', { client_id: app.clientId });
  const refused = errorSchema.safeParse(data);
  if (refused.success) throw new GitHubApiError(400, failureMessage(refused.data.error));
  const code = deviceCodeSchema.safeParse(data);
  if (!code.success) throw new GitHubApiError(502, UNEXPECTED);
  return {
    deviceCode: code.data.device_code,
    userCode: code.data.user_code,
    verificationUri: code.data.verification_uri,
    expiresAt: now + code.data.expires_in * 1000,
    intervalSeconds: code.data.interval,
  };
}

export async function pollDeviceToken(
  app: GitHubAppConfig,
  fetchImpl: typeof fetch,
  deviceCode: string,
  now: number,
): Promise<PollAnswer> {
  const data = await postForm(app, fetchImpl, '/login/oauth/access_token', {
    client_id: app.clientId,
    device_code: deviceCode,
    grant_type: DEVICE_GRANT,
  });
  const refused = errorSchema.safeParse(data);
  if (refused.success) {
    const { error, interval } = refused.data;
    if (error === 'authorization_pending') return { kind: 'pending' };
    if (error === 'slow_down') return { kind: 'slow_down', intervalSeconds: interval ?? null };
    if (error === 'expired_token') return { kind: 'expired' };
    if (error === 'access_denied') return { kind: 'denied' };
    return { kind: 'failed', message: failureMessage(error) };
  }
  const tokens = tokensOf(data, now);
  return tokens ? { kind: 'tokens', tokens } : { kind: 'failed', message: UNEXPECTED };
}

export async function refreshTokens(
  app: GitHubAppConfig,
  fetchImpl: typeof fetch,
  refreshToken: string,
  now: number,
): Promise<RefreshAnswer> {
  const data = await postForm(app, fetchImpl, '/login/oauth/access_token', {
    client_id: app.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (errorSchema.safeParse(data).success) return { kind: 'rejected' };
  const tokens = tokensOf(data, now);
  if (!tokens) throw new GitHubApiError(502, UNEXPECTED);
  return { kind: 'tokens', tokens };
}
