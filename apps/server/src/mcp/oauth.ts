import { randomBytes } from 'node:crypto';
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpSignInFlow } from '@spark-outpost/contracts';
import { startLoopback, type Loopback, type LoopbackCallback } from '../calendar/cloud/loopback.ts';
import { withTransaction, type Db } from '../persistence/db.ts';
import { sameText } from '../setup/pkce.ts';
import type { SecretStore } from '../setup/secrets.ts';
import {
  deleteSignIn,
  markSignIn,
  readSignIn,
  writeSignIn,
  type SavedSignIn,
} from './oauth-store.ts';

export const MCP_SIGN_IN_TTL_MS = 10 * 60_000;
const RENEW_BEFORE_MS = 10 * 60_000;

export const MCP_SIGN_IN_TIMED_OUT =
  'The server didn’t send you back in time. Select Sign in to start again.';
export const MCP_SIGN_IN_DENIED = 'The sign-in was cancelled.';
export const MCP_SIGN_IN_WRONG_STATE =
  'That sign-in answer doesn’t match the one Spark is waiting for. Start again.';
export const MCP_SIGN_IN_UNSUPPORTED =
  'This server doesn’t offer a sign-in Spark can use. Add its token as a header instead.';

export interface McpSignInTarget {
  id: string;
  url: string;
}

export interface McpOAuthDeps {
  db: Db;
  secrets: SecretStore;
  fetch?: FetchLike;
  now?: () => number;
}

export interface McpOAuth {
  flow(serverId: string): McpSignInFlow;
  start(server: McpSignInTarget): Promise<McpSignInFlow>;
  cancel(serverId: string): McpSignInFlow;
  settled(serverId: string): Promise<void>;
  signOut(serverId: string): Promise<void>;
  bearer(server: McpSignInTarget, options?: { renew?: boolean }): Promise<string | null>;
}

interface Pending {
  state: string;
  loopback: Loopback;
  timer: NodeJS.Timeout;
  finish(code: string): Promise<void>;
}

const IDLE: McpSignInFlow = { status: 'idle', authorizeUrl: null, expiresAt: null, message: null };

const ended = (status: McpSignInFlow['status'], message: string | null): McpSignInFlow => ({
  ...IDLE,
  status,
  message,
});

class NoSilentSignIn extends Error {}

function clientMetadata(redirectUrl: string): OAuthClientMetadata {
  return {
    client_name: 'Spark Outpost',
    redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

function registeredFor(client: OAuthClientInformationMixed | undefined, redirectUrl: string) {
  const uris = (client as { redirect_uris?: unknown } | undefined)?.redirect_uris;
  return Array.isArray(uris) && uris.includes(redirectUrl);
}

function opensInBrowser(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1');
}

export function createMcpOAuth(deps: McpOAuthDeps): McpOAuth {
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetch;
  const flows = new Map<string, McpSignInFlow>();
  const pending = new Map<string, Pending>();
  const work = new Map<string, Promise<void>>();

  const clear = (serverId: string) => {
    const waiting = pending.get(serverId);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    waiting.loopback.close();
    pending.delete(serverId);
  };

  interface Session {
    saved: SavedSignIn;
    refused: boolean;
    verifier: string;
    authorizeUrl: URL | null;
  }

  const provider = (
    serverId: string,
    session: Session,
    redirectUrl: string,
    interactive: { state: string } | null,
  ): OAuthClientProvider => {
    const persist = () => writeSignIn(deps.secrets, serverId, session.saved);
    return {
      redirectUrl,
      clientMetadata: clientMetadata(redirectUrl),
      ...(interactive ? { state: () => interactive.state } : {}),
      clientInformation: () => session.saved.client,
      async saveClientInformation(client: OAuthClientInformationMixed) {
        session.saved = { ...session.saved, client };
        await persist();
      },
      tokens: () => session.saved.tokens,
      async saveTokens(tokens: OAuthTokens) {
        const expiresAt = tokens.expires_in ? now() + tokens.expires_in * 1000 : null;
        session.saved = { ...session.saved, tokens, expiresAt };
        await persist();
      },
      redirectToAuthorization(url: URL) {
        if (!interactive) throw new NoSilentSignIn();
        session.authorizeUrl = url;
      },
      saveCodeVerifier(verifier: string) {
        session.verifier = verifier;
      },
      codeVerifier: () => session.verifier,
      async invalidateCredentials(scope) {
        const next: SavedSignIn = { ...session.saved };
        if (scope === 'all' || scope === 'tokens') {
          session.refused = true;
          delete next.tokens;
          next.expiresAt = null;
        }
        if (scope === 'all' || scope === 'client') delete next.client;
        if (scope === 'all' || scope === 'discovery') delete next.discovery;
        session.saved = next;
        await persist();
      },
      discoveryState: () => session.saved.discovery,
      async saveDiscoveryState(discovery: OAuthDiscoveryState) {
        session.saved = { ...session.saved, discovery };
        await persist();
      },
    };
  };

  const locked = <T>(serverId: string, run: () => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mcp-oauth:${serverId}`]);
      return run();
    });

  const usable = (saved: SavedSignIn | null, url: string): saved is SavedSignIn =>
    saved !== null && saved.url === url && saved.tokens !== undefined;

  const stillGood = (saved: SavedSignIn) =>
    saved.expiresAt === null || saved.expiresAt - RENEW_BEFORE_MS > now();

  const renew = (server: McpSignInTarget, force: boolean): Promise<string | null> =>
    locked(server.id, async () => {
      const saved = await readSignIn(deps.secrets, server.id, { fresh: true });
      if (!usable(saved, server.url)) return null;
      if (!force && stillGood(saved)) return saved.tokens!.access_token;
      if (!saved.tokens!.refresh_token) return force ? null : saved.tokens!.access_token;
      const session: Session = { saved, refused: false, verifier: '', authorizeUrl: null };
      const redirect = 'http://127.0.0.1';
      try {
        await auth(provider(server.id, session, redirect, null), {
          serverUrl: server.url,
          ...(fetchFn ? { fetchFn } : {}),
        });
        return session.saved.tokens?.access_token ?? null;
      } catch {
        if (!session.refused) return saved.tokens!.access_token;
        await markSignIn(deps.db, server.id, 'needed');
        return null;
      }
    });

  async function finish(server: McpSignInTarget, session: Session, redirect: string, code: string) {
    try {
      await auth(provider(server.id, session, redirect, { state: '' }), {
        serverUrl: server.url,
        authorizationCode: code,
        ...(fetchFn ? { fetchFn } : {}),
      });
      await markSignIn(deps.db, server.id, 'signed_in');
      flows.set(server.id, ended('connected', null));
    } catch {
      flows.set(server.id, ended('failed', 'The sign-in could not be finished. Start again.'));
    }
  }

  return {
    flow: (serverId) => flows.get(serverId) ?? IDLE,
    settled: (serverId) => work.get(serverId) ?? Promise.resolve(),
    cancel(serverId) {
      clear(serverId);
      flows.delete(serverId);
      return IDLE;
    },
    async start(server) {
      clear(server.id);
      const state = randomBytes(32).toString('base64url');
      const loopback = await startLoopback('your MCP server', (callback: LoopbackCallback) => {
        const waiting = pending.get(server.id);
        if (!waiting || waiting.state !== state) return;
        clear(server.id);
        if (!callback.state || !sameText(callback.state, state)) {
          flows.set(server.id, ended('failed', MCP_SIGN_IN_WRONG_STATE));
          return;
        }
        if (callback.error || !callback.code) {
          flows.set(server.id, ended('failed', MCP_SIGN_IN_DENIED));
          return;
        }
        work.set(server.id, waiting.finish(callback.code));
      });
      const redirect = loopback.redirectUri;
      const before = await readSignIn(deps.secrets, server.id, { fresh: true });
      const kept = before?.url === server.url ? before : null;
      const session: Session = {
        saved: {
          url: server.url,
          expiresAt: null,
          ...(kept?.discovery ? { discovery: kept.discovery } : {}),
          ...(kept && registeredFor(kept.client, redirect) ? { client: kept.client! } : {}),
        },
        refused: false,
        verifier: '',
        authorizeUrl: null,
      };
      try {
        await auth(provider(server.id, session, redirect, { state }), {
          serverUrl: server.url,
          ...(fetchFn ? { fetchFn } : {}),
        });
      } catch {
        loopback.close();
        flows.set(server.id, ended('failed', MCP_SIGN_IN_UNSUPPORTED));
        return flows.get(server.id)!;
      }
      if (!session.authorizeUrl || !opensInBrowser(session.authorizeUrl)) {
        loopback.close();
        flows.set(server.id, ended('failed', MCP_SIGN_IN_UNSUPPORTED));
        return flows.get(server.id)!;
      }
      const timer = setTimeout(() => {
        if (pending.get(server.id)?.state !== state) return;
        clear(server.id);
        flows.set(server.id, ended('failed', MCP_SIGN_IN_TIMED_OUT));
      }, MCP_SIGN_IN_TTL_MS);
      timer.unref();
      pending.set(server.id, {
        state,
        loopback,
        timer,
        finish: (code) => finish(server, session, redirect, code),
      });
      const flow: McpSignInFlow = {
        status: 'waiting',
        authorizeUrl: session.authorizeUrl.toString(),
        expiresAt: new Date(now() + MCP_SIGN_IN_TTL_MS).toISOString(),
        message: null,
      };
      flows.set(server.id, flow);
      return flow;
    },
    async signOut(serverId) {
      clear(serverId);
      flows.delete(serverId);
      await deleteSignIn(deps.secrets, serverId);
      await markSignIn(deps.db, serverId, 'none');
    },
    async bearer(server, options = {}) {
      const saved = await readSignIn(deps.secrets, server.id);
      if (!usable(saved, server.url)) return null;
      if (!options.renew && stillGood(saved)) return saved.tokens!.access_token;
      return renew(server, options.renew === true);
    },
  };
}
