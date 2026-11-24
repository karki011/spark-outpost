import {
  MICROSOFT_CALENDAR_SCOPES,
  MICROSOFT_EDIT_DECLINED,
  MICROSOFT_EDIT_LOST,
  MICROSOFT_EDIT_SCOPES,
  microsoftScopesEdit,
  microsoftScopesRead,
  type GoogleSignInFlow,
} from '@spark-outpost/contracts';
import { newPkce, sameText } from '../../setup/pkce.ts';
import { startLoopback, type Loopback, type LoopbackCallback } from '../cloud/loopback.ts';
import {
  MicrosoftAuthError,
  exchangeMicrosoftCode,
  microsoftAuthorizeUrl,
  type MicrosoftGrant,
  type MicrosoftOAuthDeps,
} from './oauth.ts';

export const MICROSOFT_SIGN_IN_TTL_MS = 10 * 60_000;

export const MICROSOFT_SIGN_IN_TIMED_OUT =
  'Microsoft didn’t send you back in time. Select Add Microsoft account to start again.';
export const MICROSOFT_SIGN_IN_DENIED = 'The sign-in was cancelled in Microsoft.';
export const MICROSOFT_SIGN_IN_WRONG_STATE =
  'That sign-in answer doesn’t match the one Spark is waiting for. Start again.';
export const MICROSOFT_SCOPES_MISSING =
  'Microsoft didn’t allow Spark to read your calendars. Sign in again and accept the permissions.';
export const MICROSOFT_NO_EMAIL = 'Microsoft didn’t say which account signed in. Start again.';

const DECLINED = new Set(['access_denied', 'consent_required', 'interaction_required']);

export class MicrosoftAccountMismatch extends Error {
  constructor(email: string) {
    super(`That was a different Microsoft account. Sign in as ${email}.`);
  }
}

export interface MicrosoftSignInRequest {
  accountId: string | null;
  editCalendar: string | null;
}

export interface MicrosoftConnected {
  editTurnedOff: boolean;
}

export interface MicrosoftSignInDeps extends MicrosoftOAuthDeps {
  now: () => number;
  emailOf(grant: MicrosoftGrant): Promise<string | null>;
  connect(
    grant: MicrosoftGrant & { email: string },
    request: MicrosoftSignInRequest,
  ): Promise<MicrosoftConnected>;
}

export interface MicrosoftSignIn {
  flow(): GoogleSignInFlow;
  start(
    request: MicrosoftSignInRequest & { loginHint: string | null; keepEdit: boolean },
  ): Promise<GoogleSignInFlow>;
  cancel(): GoogleSignInFlow;
  settled(): Promise<void>;
}

interface Pending {
  state: string;
  verifier: string;
  redirectUri: string;
  scopes: readonly string[];
  request: MicrosoftSignInRequest;
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
  if (error === 'access_denied') return MICROSOFT_SIGN_IN_DENIED;
  return `Microsoft ended the sign-in (${error.slice(0, 60)}).`;
}

export function createMicrosoftSignIn(deps: MicrosoftSignInDeps): MicrosoftSignIn {
  let flow = IDLE;
  let pending: Pending | null = null;
  let work: Promise<void> = Promise.resolve();

  const clear = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.loopback.close();
    pending = null;
  };

  async function connectGrant(waiting: Pending, grant: MicrosoftGrant): Promise<GoogleSignInFlow> {
    if (!microsoftScopesRead(grant.scopes)) return ended('failed', MICROSOFT_SCOPES_MISSING);
    const email = grant.email ?? (await deps.emailOf(grant));
    if (!email) return ended('failed', MICROSOFT_NO_EMAIL);
    const connected = await deps.connect({ ...grant, email }, waiting.request);
    if (waiting.request.editCalendar !== null && !microsoftScopesEdit(grant.scopes)) {
      return ended('failed', MICROSOFT_EDIT_DECLINED);
    }
    return ended('connected', connected.editTurnedOff ? MICROSOFT_EDIT_LOST : null);
  }

  async function finish(waiting: Pending, callback: LoopbackCallback): Promise<void> {
    if (!callback.state || !sameText(callback.state, waiting.state)) {
      flow = ended('failed', MICROSOFT_SIGN_IN_WRONG_STATE);
      return;
    }
    const editing = waiting.request.editCalendar !== null;
    if (callback.error || !callback.code) {
      const declined = editing && DECLINED.has(callback.error ?? '');
      flow = ended(
        'failed',
        declined ? MICROSOFT_EDIT_DECLINED : deniedMessage(callback.error ?? 'no_code'),
      );
      return;
    }
    try {
      const grant = await exchangeMicrosoftCode(
        deps,
        {
          code: callback.code,
          verifier: waiting.verifier,
          redirectUri: waiting.redirectUri,
          scopes: waiting.scopes,
        },
        deps.now(),
      );
      flow = await connectGrant(waiting, grant);
    } catch (error) {
      const message =
        error instanceof MicrosoftAuthError || error instanceof MicrosoftAccountMismatch
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
      const loopback = await startLoopback('Microsoft Calendar', (callback) => {
        if (!waiting || pending !== waiting) return;
        const answered = waiting;
        clear();
        work = finish(answered, callback);
      });
      const expiresAt = deps.now() + MICROSOFT_SIGN_IN_TTL_MS;
      const timer = setTimeout(() => {
        if (pending !== waiting) return;
        clear();
        flow = ended('failed', MICROSOFT_SIGN_IN_TIMED_OUT);
      }, MICROSOFT_SIGN_IN_TTL_MS);
      timer.unref();
      const scopes =
        request.editCalendar || request.keepEdit
          ? MICROSOFT_EDIT_SCOPES
          : MICROSOFT_CALENDAR_SCOPES;
      waiting = {
        state: pkce.state,
        verifier: pkce.verifier,
        redirectUri: loopback.redirectUri,
        scopes,
        request: { accountId: request.accountId, editCalendar: request.editCalendar },
        loopback,
        timer,
      };
      pending = waiting;
      flow = {
        status: 'waiting',
        authorizeUrl: microsoftAuthorizeUrl(deps.client, pkce, loopback.redirectUri, {
          scopes,
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
