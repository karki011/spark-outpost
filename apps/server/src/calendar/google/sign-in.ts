import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_EDIT_DECLINED,
  GOOGLE_EDIT_LOST,
  GOOGLE_EDIT_SCOPES,
  googleScopesEdit,
  googleScopesRead,
  type GoogleSignInFlow,
} from '@spark-outpost/contracts';
import { newPkce, sameText } from '../../setup/pkce.ts';
import { startLoopback, type Loopback, type LoopbackCallback } from './loopback.ts';
import {
  GoogleAuthError,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  type GoogleGrant,
  type GoogleOAuthDeps,
} from './oauth.ts';

export const GOOGLE_SIGN_IN_TTL_MS = 10 * 60_000;

export const GOOGLE_SIGN_IN_TIMED_OUT =
  'Google didn’t send you back in time. Select Add Google account to start again.';
export const GOOGLE_SIGN_IN_DENIED = 'The sign-in was cancelled in Google.';
export const GOOGLE_SIGN_IN_WRONG_STATE =
  'That sign-in answer doesn’t match the one Spark is waiting for. Start again.';
export const GOOGLE_SCOPES_MISSING =
  'Google didn’t allow Spark to see your calendars and events. Sign in again and leave both calendar boxes ticked.';

export class GoogleAccountMismatch extends Error {
  constructor(email: string) {
    super(`That was a different Google account. Sign in as ${email}.`);
  }
}

export interface GoogleSignInDeps extends GoogleOAuthDeps {
  now: () => number;
  connect(grant: GoogleGrant, request: GoogleSignInRequest): Promise<Connected>;
  discard(grant: GoogleGrant): Promise<void>;
}

export interface Connected {
  editTurnedOff: boolean;
}

export interface GoogleSignInRequest {
  accountId: string | null;
  editCalendar: string | null;
}

export interface GoogleSignIn {
  flow(): GoogleSignInFlow;
  start(request: GoogleSignInRequest & { loginHint: string | null }): Promise<GoogleSignInFlow>;
  cancel(): GoogleSignInFlow;
  settled(): Promise<void>;
}

interface Pending {
  state: string;
  verifier: string;
  redirectUri: string;
  request: GoogleSignInRequest;
  loopback: Loopback;
  timer: NodeJS.Timeout;
}

const IDLE: GoogleSignInFlow = {
  status: 'idle',
  authorizeUrl: null,
  expiresAt: null,
  message: null,
};

const ended = (status: GoogleSignInFlow['status'], message: string | null): GoogleSignInFlow => ({
  ...IDLE,
  status,
  message,
});

function deniedMessage(error: string): string {
  if (error === 'access_denied') return GOOGLE_SIGN_IN_DENIED;
  return `Google ended the sign-in (${error.slice(0, 60)}).`;
}

export function createGoogleSignIn(deps: GoogleSignInDeps): GoogleSignIn {
  let flow = IDLE;
  let pending: Pending | null = null;
  let work: Promise<void> = Promise.resolve();

  const clear = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.loopback.close();
    pending = null;
  };

  async function finish(waiting: Pending, callback: LoopbackCallback): Promise<void> {
    if (!callback.state || !sameText(callback.state, waiting.state)) {
      flow = ended('failed', GOOGLE_SIGN_IN_WRONG_STATE);
      return;
    }
    const editing = waiting.request.editCalendar !== null;
    if (callback.error || !callback.code) {
      const denied = editing && callback.error === 'access_denied';
      flow = ended(
        'failed',
        denied ? GOOGLE_EDIT_DECLINED : deniedMessage(callback.error ?? 'no_code'),
      );
      return;
    }
    try {
      const grant = await exchangeGoogleCode(
        deps,
        { code: callback.code, verifier: waiting.verifier, redirectUri: waiting.redirectUri },
        deps.now(),
      );
      if (!googleScopesRead(grant.scopes)) {
        await deps.discard(grant);
        flow = ended('failed', GOOGLE_SCOPES_MISSING);
        return;
      }
      const connected = await deps.connect(grant, waiting.request);
      if (editing && !googleScopesEdit(grant.scopes)) flow = ended('failed', GOOGLE_EDIT_DECLINED);
      else flow = ended('connected', connected.editTurnedOff ? GOOGLE_EDIT_LOST : null);
    } catch (error) {
      const message =
        error instanceof GoogleAuthError || error instanceof GoogleAccountMismatch
          ? error.message
          : 'The sign-in could not be finished.';
      flow = ended('failed', message);
    }
  }

  return {
    flow: () => flow,
    settled: () => work,
    async start(request) {
      clear();
      const pkce = newPkce();
      let waiting: Pending | null = null;
      const loopback = await startLoopback((callback) => {
        if (!waiting || pending !== waiting) return;
        const answered = waiting;
        clear();
        work = finish(answered, callback);
      });
      const expiresAt = deps.now() + GOOGLE_SIGN_IN_TTL_MS;
      const timer = setTimeout(() => {
        if (pending !== waiting) return;
        clear();
        flow = ended('failed', GOOGLE_SIGN_IN_TIMED_OUT);
      }, GOOGLE_SIGN_IN_TTL_MS);
      timer.unref();
      waiting = {
        state: pkce.state,
        verifier: pkce.verifier,
        redirectUri: loopback.redirectUri,
        request: { accountId: request.accountId, editCalendar: request.editCalendar },
        loopback,
        timer,
      };
      pending = waiting;
      flow = {
        status: 'waiting',
        authorizeUrl: googleAuthorizeUrl(deps.client, pkce, loopback.redirectUri, {
          scopes: request.editCalendar ? GOOGLE_EDIT_SCOPES : GOOGLE_CALENDAR_SCOPES,
          loginHint: request.loginHint,
        }),
        expiresAt: new Date(expiresAt).toISOString(),
        message: null,
      };
      return flow;
    },
    cancel() {
      clear();
      flow = IDLE;
      return flow;
    },
  };
}
