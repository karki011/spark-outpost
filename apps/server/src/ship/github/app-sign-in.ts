import type { GitHubAppSignIn } from '@spark-outpost/contracts';
import { saveAppConnection } from '../../persistence/github-app.ts';
import { apiBaseFor } from '../remote.ts';
import { GITHUB_APP_HOST, type GitHubAppConfig } from './app-config.ts';
import {
  pollDeviceToken,
  requestDeviceCode,
  SLOW_DOWN_SECONDS,
  type AppTokens,
  type DeviceCode,
  type PollAnswer,
} from './app-oauth.ts';
import { reachableRepos } from './app-repos.ts';
import { storeAppTokens, tokenTimes, type AppTokenDeps } from './app-tokens.ts';
import { GitHubApiError, restConnection } from './connection.ts';
import { tokenRequest } from './transports.ts';

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface SignInDeps extends AppTokenDeps {
  app: GitHubAppConfig;
  apiUrl?: string | undefined;
  sleep?: Sleep;
  onConnected?: () => void;
}

export interface AppSignIn {
  state(): GitHubAppSignIn;
  start(): Promise<GitHubAppSignIn>;
  cancel(): GitHubAppSignIn;
}

const IDLE: GitHubAppSignIn = {
  status: 'idle',
  userCode: null,
  verificationUri: null,
  expiresAt: null,
  message: null,
};

const ENDED = {
  expired: 'That code ran out before it was used. Start again for a new one.',
  denied: 'The sign-in was cancelled on GitHub.',
} as const;

const waitFor: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

function ended(status: GitHubAppSignIn['status'], message: string | null): GitHubAppSignIn {
  return { ...IDLE, status, message };
}

function reason(error: unknown): string {
  return error instanceof GitHubApiError ? error.message : 'The sign-in could not be finished.';
}

function retryAfterFailure(error: unknown): PollAnswer {
  const busy = error instanceof GitHubApiError && error.status === 429;
  return busy ? { kind: 'slow_down', intervalSeconds: null } : { kind: 'pending' };
}

async function connect(deps: SignInDeps, tokens: AppTokens): Promise<void> {
  const request = tokenRequest(
    apiBaseFor(GITHUB_APP_HOST, deps.apiUrl),
    tokens.accessToken,
    deps.fetch,
  );
  const { login } = await restConnection('app', GITHUB_APP_HOST, request).whoami();
  const repos = await reachableRepos(request);
  await storeAppTokens(deps, tokens);
  await saveAppConnection(deps.db, deps.workspaceId, login, tokenTimes(tokens), repos);
  deps.onConnected?.();
}

async function outcome(
  deps: SignInDeps,
  code: DeviceCode,
  signal: AbortSignal,
): Promise<GitHubAppSignIn | null> {
  const now = () => deps.now?.() ?? Date.now();
  const sleep = deps.sleep ?? waitFor;
  let seconds = Math.max(1, code.intervalSeconds);
  for (;;) {
    await sleep(seconds * 1000, signal);
    if (signal.aborted) return null;
    if (now() >= code.expiresAt) return ended('expired', ENDED.expired);
    const answer = await pollDeviceToken(deps.app, deps.fetch, code.deviceCode, now()).catch(
      retryAfterFailure,
    );
    if (signal.aborted) return null;
    if (answer.kind === 'pending') continue;
    if (answer.kind === 'slow_down') {
      seconds = answer.intervalSeconds ?? seconds + SLOW_DOWN_SECONDS;
      continue;
    }
    if (answer.kind === 'expired' || answer.kind === 'denied') {
      return ended(answer.kind, ENDED[answer.kind]);
    }
    if (answer.kind === 'failed') return ended('failed', answer.message);
    await connect(deps, answer.tokens);
    return ended('connected', null);
  }
}

export function createAppSignIn(deps: SignInDeps): AppSignIn {
  let flow = IDLE;
  let running: AbortController | null = null;

  async function follow(code: DeviceCode, controller: AbortController) {
    const result = await outcome(deps, code, controller.signal).catch((error: unknown) =>
      ended('failed', reason(error)),
    );
    if (running !== controller) return;
    running = null;
    if (result) flow = result;
  }

  return {
    state: () => flow,
    async start() {
      if (running) return flow;
      const controller = new AbortController();
      running = controller;
      flow = ended('starting', null);
      try {
        const code = await requestDeviceCode(deps.app, deps.fetch, deps.now?.() ?? Date.now());
        if (running !== controller) return flow;
        flow = {
          status: 'waiting',
          userCode: code.userCode,
          verificationUri: code.verificationUri,
          expiresAt: new Date(code.expiresAt).toISOString(),
          message: null,
        };
        void follow(code, controller);
        return flow;
      } catch (error) {
        if (running === controller) {
          running = null;
          flow = ended('failed', reason(error));
        }
        throw error;
      }
    },
    cancel() {
      running?.abort();
      running = null;
      flow = IDLE;
      return flow;
    },
  };
}
