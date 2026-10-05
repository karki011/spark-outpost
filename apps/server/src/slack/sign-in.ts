import { timingSafeEqual } from 'node:crypto';
import {
  parseSlackCallbackLink,
  slackSignInScopes,
  type SlackSignInFlow,
  type StartSlackSignInRequest,
} from '@spark-outpost/contracts';
import { saveSlackSignIn } from '../persistence/slack-sign-in.ts';
import {
  deleteSlackConnection,
  getSlackConnection,
  recordSlackEvent,
} from '../persistence/slack.ts';
import { SLACK_SECRET_IDS } from '../setup/secrets.ts';
import { clientFor, slackAuthTest, slackMemberName, type SlackDeps } from './connection.ts';
import { exchangeSlackCode, newSlackPkce, slackAuthorizeUrl } from './oauth.ts';
import type { SlackSignInConfig } from './sign-in-config.ts';
import { slackTokenTimes, storeSlackSignInTokens } from './user-token.ts';
import { SlackApiError } from './web-api.ts';

export const SIGN_IN_TTL_MS = 10 * 60_000;

export const SWITCH_TO_SIGN_IN =
  'Slack is connected with your own Slack app. Confirm the switch to sign in with Slack instead.';
export const SIGN_IN_TIMED_OUT =
  "Slack didn't send you back in time. If your workspace asks an admin to approve apps, the request is with them: sign in again once Spark Outpost is approved.";
export const SIGN_IN_WRONG_STATE =
  "That Slack sign-in link doesn't match a sign-in Spark is waiting for. Start again in Settings → Connectors → Slack.";
export const SIGN_IN_DENIED = 'The sign-in was cancelled in Slack.';

export interface SlackSignInDeps extends SlackDeps {
  signIn: SlackSignInConfig;
}

export interface SlackSignIn {
  state(): SlackSignInFlow;
  start(request: StartSlackSignInRequest): Promise<SlackSignInFlow>;
  cancel(): SlackSignInFlow;
  complete(url: string): Promise<SlackSignInFlow>;
}

interface Pending {
  state: string;
  verifier: string;
  expiresAt: number;
}

const IDLE: SlackSignInFlow = {
  status: 'idle',
  authorizeUrl: null,
  expiresAt: null,
  message: null,
};

const ended = (status: SlackSignInFlow['status'], message: string | null): SlackSignInFlow => ({
  ...IDLE,
  status,
  message,
});

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function refusedInSlack(error: string): string {
  if (error === 'access_denied') return SIGN_IN_DENIED;
  return `Slack ended the sign-in (${error.slice(0, 60)}). If your workspace asks an admin to approve apps, try again once Spark Outpost is approved.`;
}

function reason(error: unknown): string {
  return error instanceof SlackApiError ? error.message : 'The sign-in could not be finished.';
}

async function connect(deps: SlackSignInDeps, code: string, verifier: string): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const exchanged = await exchangeSlackCode(deps, deps.signIn, { code, verifier }, now);
  const client = clientFor(deps, exchanged.tokens.accessToken);
  const who = await slackAuthTest(client);
  if (who.isBot || who.userId !== exchanged.userId) {
    throw new SlackApiError('not_user_token', 'Slack sent an unexpected token for this sign-in.');
  }
  const name = await slackMemberName(client, who.userId).catch(() => who.user || who.userId);
  const before = await getSlackConnection(deps.db, deps.workspaceId);
  if (before && before.teamId !== who.teamId) {
    await deleteSlackConnection(deps.db, deps.workspaceId);
  }
  await storeSlackSignInTokens(deps, exchanged.tokens);
  await saveSlackSignIn(deps.db, deps.workspaceId, {
    teamId: who.teamId,
    teamName: who.team,
    teamUrl: who.url,
    member: { id: who.userId, name },
    userScopes: who.scopes ?? exchanged.scopes,
    times: slackTokenTimes(exchanged.tokens),
  });
  if (before?.method === 'own_app') {
    for (const id of SLACK_SECRET_IDS) await deps.secrets.delete(id).catch(() => undefined);
  }
  await recordSlackEvent(deps.db, deps.workspaceId, {
    action: 'connect',
    outcome: 'succeeded',
    detail: {
      team: who.team,
      method: 'sign_in',
      replaced: before?.method === 'own_app' ? 'own_app' : null,
    },
  });
}

export function createSlackSignIn(deps: SlackSignInDeps, onConnected?: () => void): SlackSignIn {
  const now = () => deps.now?.() ?? Date.now();
  let flow = IDLE;
  let pending: Pending | null = null;

  const failed = async (why: string, message: string): Promise<SlackSignInFlow> => {
    await recordSlackEvent(deps.db, deps.workspaceId, {
      action: 'connect',
      outcome: 'failed',
      detail: { method: 'sign_in', reason: why },
    });
    return ended('failed', message);
  };

  function current(): SlackSignInFlow {
    if (pending && now() >= pending.expiresAt) {
      pending = null;
      flow = ended('failed', SIGN_IN_TIMED_OUT);
    }
    return flow;
  }

  return {
    state: current,
    async start(request) {
      const before = await getSlackConnection(deps.db, deps.workspaceId);
      if (before?.method === 'own_app' && !request.replace) {
        throw new SlackApiError('method_switch', SWITCH_TO_SIGN_IN);
      }
      const pkce = newSlackPkce();
      const expiresAt = now() + SIGN_IN_TTL_MS;
      pending = { state: pkce.state, verifier: pkce.verifier, expiresAt };
      flow = {
        status: 'waiting',
        authorizeUrl: slackAuthorizeUrl(
          deps.signIn,
          pkce,
          slackSignInScopes(request.directMessages),
        ),
        expiresAt: new Date(expiresAt).toISOString(),
        message: null,
      };
      return flow;
    },
    cancel() {
      pending = null;
      flow = IDLE;
      return flow;
    },
    async complete(url) {
      const link = parseSlackCallbackLink(url, deps.signIn.linkScheme);
      if (!link) throw new SlackApiError('bad_callback', "That isn't a Slack sign-in link.");
      current();
      const waiting = pending;
      if (!waiting || !link.state || !sameText(link.state, waiting.state)) {
        await failed('state', SIGN_IN_WRONG_STATE);
        throw new SlackApiError('bad_state', SIGN_IN_WRONG_STATE);
      }
      pending = null;
      if (link.error || !link.code) {
        flow = await failed(link.error ?? 'no_code', refusedInSlack(link.error ?? 'no_code'));
        return flow;
      }
      try {
        await connect(deps, link.code, waiting.verifier);
        flow = ended('connected', null);
        onConnected?.();
      } catch (error) {
        flow = await failed('exchange', reason(error));
      }
      return flow;
    },
  };
}
