import { startLoopback, type Loopback } from '../calendar/cloud/loopback.ts';
import { newPkce, sameText } from '../setup/pkce.ts';
import type { CloudflareClientConfig } from './client.ts';
import {
  CloudflareSignInError,
  cloudflareAuthorizeUrl,
  exchangeCloudflareCode,
  type CloudflareToken,
} from './oauth.ts';
import { SETUP_DENIED, SETUP_TIMED_OUT, SETUP_WRONG_STATE } from './setup-problems.ts';

export const CLOUDFLARE_SIGN_IN_TTL_MS = 10 * 60_000;
export const CLOUDFLARE_CALLBACK_PATH = '/oauth/callback';

export type CloudflareSignInResult =
  { ok: true; token: CloudflareToken } | { ok: false; problem: string };

export interface CloudflareSignIn {
  authorizeUrl: string;
  cancel(): void;
  settled(): Promise<void>;
}

export interface CloudflareSignInDeps {
  client: CloudflareClientConfig;
  fetch: typeof fetch;
  now: () => number;
}

export async function beginCloudflareSignIn(
  deps: CloudflareSignInDeps,
  scopes: string[],
  onResult: (result: CloudflareSignInResult) => Promise<void>,
): Promise<CloudflareSignIn> {
  const pkce = newPkce();
  let open = true;
  let work: Promise<void> = Promise.resolve();
  let loopback: Loopback | null = null;
  const close = () => {
    open = false;
    clearTimeout(timer);
    loopback?.close();
  };
  const timer = setTimeout(() => {
    if (!open) return;
    close();
    work = onResult({ ok: false, problem: SETUP_TIMED_OUT });
  }, CLOUDFLARE_SIGN_IN_TTL_MS);
  timer.unref();
  loopback = await startLoopback(
    'Cloudflare',
    (callback) => {
      if (!open) return;
      const redirectUri = loopback!.redirectUri;
      close();
      work = (async () => {
        if (!callback.state || !sameText(callback.state, pkce.state)) {
          await onResult({ ok: false, problem: SETUP_WRONG_STATE });
          return;
        }
        if (callback.error || !callback.code) {
          await onResult({ ok: false, problem: SETUP_DENIED });
          return;
        }
        try {
          const token = await exchangeCloudflareCode(
            { fetch: deps.fetch, client: deps.client },
            { code: callback.code, verifier: pkce.verifier, redirectUri },
            deps.now(),
          );
          await onResult({ ok: true, token });
        } catch (error) {
          const problem =
            error instanceof CloudflareSignInError
              ? error.message
              : 'The sign-in could not be finished.';
          await onResult({ ok: false, problem });
        }
      })();
    },
    CLOUDFLARE_CALLBACK_PATH,
  );
  return {
    authorizeUrl: cloudflareAuthorizeUrl(deps.client, pkce, loopback.redirectUri, scopes),
    cancel: close,
    settled: () => work,
  };
}
