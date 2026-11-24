import {
  ZOOM_NOT_CONNECTED,
  ZOOM_SIGN_IN_AGAIN,
  type GoogleSignInFlow,
  type ZoomStatus,
} from '@spark-outpost/contracts';
import { startLoopback, type Loopback, type LoopbackCallback } from '../calendar/cloud/loopback.ts';
import type { Db } from '../persistence/db.ts';
import { newPkce, sameText } from '../setup/pkce.ts';
import { zoomSecret, type SecretStore } from '../setup/secrets.ts';
import {
  ZoomUnauthorized,
  createZoomMeeting,
  deleteZoomMeeting,
  getZoomUser,
  type ZoomMeeting,
  type ZoomMeetingRequest,
} from './api.ts';
import type { ZoomClientConfig } from './config.ts';
import {
  ZoomError,
  exchangeZoomCode,
  refreshZoomTokens,
  revokeZoomToken,
  zoomAuthorizeUrl,
  type ZoomDeps,
  type ZoomTokens,
} from './oauth.ts';

export const ZOOM_SIGN_IN_TTL_MS = 10 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
export const ZOOM_KEEP_ALIVE_AFTER_MS = 7 * DAY_MS;

export const ZOOM_SIGN_IN_TIMED_OUT =
  'Zoom didn’t send you back in time. Select Connect to start again.';
export const ZOOM_SIGN_IN_DENIED = 'The sign-in was cancelled in Zoom.';
export const ZOOM_SIGN_IN_WRONG_STATE =
  'That sign-in answer doesn’t match the one Spark is waiting for. Start again.';
export const ZOOM_UNAVAILABLE = 'This build has no Zoom sign-in.';

export class ZoomSignInNeeded extends Error {
  constructor(message = ZOOM_SIGN_IN_AGAIN) {
    super(message);
  }
}

export interface ZoomServiceDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  client: ZoomClientConfig | null;
  now?: () => number;
}

export interface ZoomService {
  status(): Promise<ZoomStatus>;
  signIn(): Promise<GoogleSignInFlow>;
  signInFlow(): GoogleSignInFlow;
  cancelSignIn(): GoogleSignInFlow;
  signInSettled(): Promise<void>;
  disconnect(): Promise<{ found: boolean; revoked: boolean }>;
  createMeeting(request: ZoomMeetingRequest): Promise<ZoomMeeting>;
  deleteMeeting(meetingId: string): Promise<void>;
  keepAlive(): Promise<void>;
  start(): void;
}

interface AccountRow {
  subject: string;
  email: string;
  needs_sign_in: boolean;
  renewed_at: Date;
}

interface Pending {
  state: string;
  verifier: string;
  redirectUri: string;
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

export function createZoomService(deps: ZoomServiceDeps): ZoomService {
  const now = deps.now ?? Date.now;
  const client = deps.client;
  let flow = IDLE;
  let pending: Pending | null = null;
  let work: Promise<void> = Promise.resolve();
  let live: { accessToken: string; expiresAt: number } | null = null;
  let renewing: Promise<string> | null = null;

  const zoom = (): ZoomDeps => {
    if (!client) throw new ZoomError('refused', ZOOM_UNAVAILABLE);
    return { fetch: deps.fetch, client };
  };

  const account = async (): Promise<AccountRow | null> => {
    const { rows } = await deps.db.query<AccountRow>(
      `SELECT subject, email, needs_sign_in, renewed_at FROM zoom_accounts WHERE workspace_id = $1`,
      [deps.workspaceId],
    );
    return rows[0] ?? null;
  };

  const needSignIn = async (): Promise<never> => {
    live = null;
    await deps.db.query(`UPDATE zoom_accounts SET needs_sign_in = true WHERE workspace_id = $1`, [
      deps.workspaceId,
    ]);
    throw new ZoomSignInNeeded();
  };

  const keep = async (subject: string, tokens: ZoomTokens): Promise<string> => {
    await deps.secrets.set(zoomSecret(subject), tokens.refreshToken);
    await deps.db.query(
      `UPDATE zoom_accounts SET renewed_at = to_timestamp($2 / 1000.0) WHERE workspace_id = $1`,
      [deps.workspaceId, now()],
    );
    live = { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
    return tokens.accessToken;
  };

  const renew = async (): Promise<string> => {
    const row = await account();
    if (!row) throw new ZoomSignInNeeded(ZOOM_NOT_CONNECTED);
    if (row.needs_sign_in) throw new ZoomSignInNeeded();
    const refreshToken = await deps.secrets.get(zoomSecret(row.subject));
    if (!refreshToken) return needSignIn();
    const renewed = await refreshZoomTokens(zoom(), refreshToken, now());
    if (renewed.kind === 'rejected') return needSignIn();
    return keep(row.subject, renewed);
  };

  const renewOnce = (): Promise<string> => {
    renewing ??= renew().finally(() => {
      renewing = null;
    });
    return renewing;
  };

  const accessToken = (): Promise<string> => {
    if (live && live.expiresAt - EXPIRY_MARGIN_MS > now()) return Promise.resolve(live.accessToken);
    return renewOnce();
  };

  const withToken = async <T>(call: (token: string) => Promise<T>): Promise<T> => {
    try {
      return await call(await accessToken());
    } catch (error) {
      if (!(error instanceof ZoomUnauthorized)) throw error;
      live = null;
      try {
        return await call(await accessToken());
      } catch (again) {
        if (again instanceof ZoomUnauthorized) return needSignIn();
        throw again;
      }
    }
  };

  const clear = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.loopback.close();
    pending = null;
  };

  const connect = async (tokens: ZoomTokens): Promise<void> => {
    const user = await getZoomUser(zoom(), tokens.accessToken);
    const before = await account();
    await keep(user.id, tokens);
    await deps.db.query(
      `INSERT INTO zoom_accounts (workspace_id, subject, email, renewed_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
       ON CONFLICT (workspace_id)
         DO UPDATE SET subject = EXCLUDED.subject, email = EXCLUDED.email,
           needs_sign_in = false, renewed_at = EXCLUDED.renewed_at`,
      [deps.workspaceId, user.id, user.email, now()],
    );
    if (before && before.subject !== user.id) await deps.secrets.delete(zoomSecret(before.subject));
  };

  async function finish(waiting: Pending, callback: LoopbackCallback): Promise<void> {
    if (!callback.state || !sameText(callback.state, waiting.state)) {
      flow = ended('failed', ZOOM_SIGN_IN_WRONG_STATE);
      return;
    }
    if (callback.error || !callback.code) {
      flow = ended('failed', ZOOM_SIGN_IN_DENIED);
      return;
    }
    try {
      const tokens = await exchangeZoomCode(
        zoom(),
        { code: callback.code, verifier: waiting.verifier, redirectUri: waiting.redirectUri },
        now(),
      );
      await connect(tokens);
      flow = ended('connected', null);
    } catch (error) {
      flow = ended(
        'failed',
        error instanceof ZoomError ? error.message : 'The sign-in could not be finished.',
      );
    }
  }

  return {
    async status() {
      const row = client ? await account() : null;
      return {
        available: client !== null,
        account: row ? { email: row.email, needsSignIn: row.needs_sign_in } : null,
        signIn: flow,
      };
    },
    signInFlow: () => flow,
    signInSettled: () => work,
    async signIn() {
      const config = zoom().client;
      clear();
      const pkce = newPkce();
      let waiting: Pending | null = null;
      const loopback = await startLoopback('Zoom', (callback) => {
        if (!waiting || pending !== waiting) return;
        const answered = waiting;
        clear();
        work = finish(answered, callback);
      });
      const timer = setTimeout(() => {
        if (pending !== waiting) return;
        clear();
        flow = ended('failed', ZOOM_SIGN_IN_TIMED_OUT);
      }, ZOOM_SIGN_IN_TTL_MS);
      timer.unref();
      waiting = {
        state: pkce.state,
        verifier: pkce.verifier,
        redirectUri: loopback.redirectUri,
        loopback,
        timer,
      };
      pending = waiting;
      flow = {
        status: 'waiting',
        authorizeUrl: zoomAuthorizeUrl(config, pkce, loopback.redirectUri),
        expiresAt: new Date(now() + ZOOM_SIGN_IN_TTL_MS).toISOString(),
        message: null,
      };
      return flow;
    },
    cancelSignIn() {
      clear();
      flow = IDLE;
      return flow;
    },
    async disconnect() {
      const row = await account();
      if (!row) return { found: false, revoked: false };
      const token = client ? await accessToken().catch(() => null) : null;
      const revoked = token ? await revokeZoomToken(zoom(), token) : false;
      live = null;
      await deps.secrets.delete(zoomSecret(row.subject));
      await deps.db.query(`DELETE FROM zoom_accounts WHERE workspace_id = $1`, [deps.workspaceId]);
      flow = IDLE;
      return { found: true, revoked };
    },
    createMeeting: (request) => withToken((token) => createZoomMeeting(zoom(), token, request)),
    async keepAlive() {
      const row = client ? await account() : null;
      if (!row || row.needs_sign_in) return;
      if (now() - row.renewed_at.getTime() < ZOOM_KEEP_ALIVE_AFTER_MS) return;
      await renewOnce().catch(() => undefined);
    },
    start() {
      void this.keepAlive();
      setInterval(() => void this.keepAlive(), DAY_MS).unref();
    },
    deleteMeeting: (meetingId) => withToken((token) => deleteZoomMeeting(zoom(), token, meetingId)),
  };
}
