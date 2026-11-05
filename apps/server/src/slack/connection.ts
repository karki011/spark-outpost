import { missingSlackDmScopes, slackSettingsSchema } from '@spark-outpost/contracts';
import type {
  SaveSlackConnectionRequest,
  SlackCapabilities,
  SlackDirectMessages,
  SlackSocketState,
  SlackStatus,
  UpdateSlackSettingsRequest,
} from '@spark-outpost/contracts';
import {
  allowedSlackChannels,
  allowedSlackDms,
  deleteSlackConnection,
  getSlackConnection,
  recordSlackEvent,
  replaceAllowedSlackDms,
  saveSlackConnection,
  saveSlackMember,
  saveSlackSettings,
  saveSlackUserScopes,
  type SlackConnectionRow,
} from '../persistence/slack.ts';
import { SLACK_SECRET_IDS, type SlackSecretId } from '../setup/secrets.ts';
import { notifyTarget } from './notify-plan.ts';
import {
  forgetSlackSignIn,
  refreshSlackSignInToken,
  savedSlackSignInToken,
  slackSignInToken,
  type SlackTokenDeps,
} from './user-token.ts';
import {
  SLACK_SIGN_IN_AGAIN,
  SlackApiError,
  SlackChannelNotAllowedError,
  SlackNotConnectedError,
  slackAnswer,
  slackCall,
  slackText,
  type SlackClient,
} from './web-api.ts';

export interface SlackDeps extends SlackTokenDeps {
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

export interface SlackTokens {
  bot: string;
  user: string | null;
  app: string | null;
}

const saved = (deps: SlackDeps, id: SlackSecretId) => deps.secrets.get(id).catch(() => null);

export async function slackTokens(deps: SlackDeps): Promise<SlackTokens | null> {
  const [bot, user, app] = await Promise.all(SLACK_SECRET_IDS.map((id) => saved(deps, id)));
  return bot ? { bot, user: user ?? null, app: app ?? null } : null;
}

export function clientFor(deps: SlackDeps, token: string, botName?: string): SlackClient {
  return { fetch: deps.fetch, apiUrl: deps.slackApiUrl, token, botName, sleep: deps.sleep };
}

export interface OpenSlack {
  connection: SlackConnectionRow;
  tokens: Pick<SlackTokens, 'user' | 'app'>;
  main: SlackClient;
  user: SlackClient | null;
}

async function openSignedIn(
  deps: SlackDeps,
  connection: SlackConnectionRow,
): Promise<OpenSlack | null> {
  const token = await slackSignInToken(deps, connection);
  if (!token) return null;
  const client: SlackClient = {
    ...clientFor(deps, token),
    asUser: true,
    renew: (usedToken) => refreshSlackSignInToken(deps, usedToken),
  };
  return { connection, tokens: { user: token, app: null }, main: client, user: client };
}

export async function openSlack(deps: SlackDeps): Promise<OpenSlack | null> {
  const connection = await getSlackConnection(deps.db, deps.workspaceId);
  if (!connection) return null;
  if (connection.method === 'sign_in') return openSignedIn(deps, connection);
  const tokens = await slackTokens(deps);
  if (!tokens) return null;
  return {
    connection,
    tokens,
    main: clientFor(deps, tokens.bot, connection.botName),
    user: tokens.user ? clientFor(deps, tokens.user, connection.botName) : null,
  };
}

export async function requireSlack(deps: SlackDeps): Promise<OpenSlack> {
  const open = await openSlack(deps);
  if (open) return open;
  const connection = await getSlackConnection(deps.db, deps.workspaceId);
  throw new SlackNotConnectedError(
    connection?.method === 'sign_in' ? SLACK_SIGN_IN_AGAIN : undefined,
  );
}

export const NEEDS_OWN_APP = 'your own Slack app (Settings → Connectors → Slack)';

export function slackNotifyTarget(connection: SlackConnectionRow): string | null {
  if (connection.method === 'sign_in') return connection.memberId;
  return notifyTarget(connection.memberId, connection.settings);
}

export async function slackUserScopes(
  deps: SlackDeps,
  connection: SlackConnectionRow,
  userToken: string | null,
): Promise<string[] | null> {
  if (connection.userScopes) return connection.userScopes;
  if (!userToken) return null;
  const scopes = await slackAnswer(clientFor(deps, userToken), 'auth.test').then(
    (answer) => answer.scopes,
    () => null,
  );
  if (scopes) await saveSlackUserScopes(deps.db, deps.workspaceId, scopes);
  return scopes;
}

export function directMessagesBlock(
  hasUserToken: boolean,
  scopes: readonly string[] | null,
): Pick<SlackDirectMessages, 'blockedBy' | 'missingScopes'> {
  if (!hasUserToken) return { blockedBy: 'user_token', missingScopes: [] };
  const missingScopes = missingSlackDmScopes(scopes);
  return { blockedBy: missingScopes.length > 0 ? 'scopes' : null, missingScopes };
}

export const DIRECT_MESSAGES_NEED_USER_TOKEN =
  "Reading direct messages needs a user token (xoxp-), because the app isn't in your direct messages. Add one in Settings → Connectors → Slack.";

export const DIRECT_MESSAGES_NEED_SCOPES =
  'Update the Slack app to allow direct messages: Settings → Connectors → Slack shows the steps.';

export const DIRECT_MESSAGES_NEED_SIGN_IN =
  'Reading direct messages needs your approval in Slack: Settings → Connectors → Slack → Allow direct messages in Slack.';

export function directMessagesScopeMessage(connection: SlackConnectionRow): string {
  return connection.method === 'sign_in'
    ? DIRECT_MESSAGES_NEED_SIGN_IN
    : DIRECT_MESSAGES_NEED_SCOPES;
}

function capabilities(
  connection: SlackConnectionRow,
  tokens: { user: boolean; app: boolean },
  directBlocked: boolean,
): SlackCapabilities {
  const { settings } = connection;
  const usable = connection.state === 'connected';
  return {
    readDirectMessages: usable && settings.readDirectMessages && !directBlocked,
    notify: usable && slackNotifyTarget(connection) !== null,
    readThreads: usable,
    readUnjoined: usable && tokens.user,
    search: usable && tokens.user,
    post: usable,
    startFromSlack: usable && tokens.app && settings.startFromSlack,
  };
}

type TokensPresent = NonNullable<SlackStatus['connection']>['tokens'];

async function tokensPresent(
  deps: SlackDeps,
  connection: SlackConnectionRow,
): Promise<{ present: TokensPresent; userToken: string | null } | null> {
  if (connection.method === 'sign_in') {
    return { present: { bot: false, user: true, app: false }, userToken: null };
  }
  const tokens = await slackTokens(deps);
  if (!tokens) return null;
  return {
    present: { bot: true, user: tokens.user !== null, app: tokens.app !== null },
    userToken: tokens.user,
  };
}

export async function slackStatus(
  deps: SlackDeps,
  socket: SlackSocketState = 'off',
): Promise<SlackStatus> {
  const signInAvailable = Boolean(deps.signIn);
  const connection = await getSlackConnection(deps.db, deps.workspaceId);
  const tokens = connection ? await tokensPresent(deps, connection) : null;
  if (!connection || !tokens) return { connection: null, signInAvailable };
  const { present } = tokens;
  const block = directMessagesBlock(
    present.user,
    await slackUserScopes(deps, connection, tokens.userToken),
  );
  return {
    signInAvailable,
    connection: {
      method: connection.method,
      state: connection.state,
      team: connection.teamName,
      teamUrl: connection.teamUrl,
      botName: connection.botName,
      member:
        connection.memberId === null
          ? null
          : { id: connection.memberId, name: connection.memberName ?? connection.memberId },
      tokens: present,
      capabilities: capabilities(connection, present, block.blockedBy !== null),
      validatedAt: connection.validatedAt.toISOString(),
      settings: connection.settings,
      allowedChannels: await allowedSlackChannels(deps.db, deps.workspaceId),
      directMessages: { ...block, allowed: await allowedSlackDms(deps.db, deps.workspaceId) },
      socket,
      lastProblem:
        connection.problem && connection.problemAt
          ? { message: connection.problem, at: connection.problemAt.toISOString() }
          : null,
    },
  };
}

export interface SlackWho {
  teamId: string;
  team: string;
  url: string;
  userId: string;
  user: string;
  isBot: boolean;
  scopes: string[] | null;
}

export async function slackAuthTest(client: SlackClient): Promise<SlackWho> {
  const { data, scopes } = await slackAnswer(client, 'auth.test');
  return {
    scopes,
    teamId: slackText(data.team_id),
    team: slackText(data.team),
    url: slackText(data.url),
    userId: slackText(data.user_id),
    user: slackText(data.user),
    isBot: typeof data.bot_id === 'string',
  };
}

export async function slackMemberName(client: SlackClient, userId: string): Promise<string> {
  const data = await slackCall(client, 'users.info', { user: userId });
  const user = (data.user ?? {}) as { real_name?: unknown; name?: unknown };
  return slackText(user.real_name) || slackText(user.name) || userId;
}

async function validated(deps: SlackDeps, request: SaveSlackConnectionRequest) {
  const bot = await slackAuthTest(clientFor(deps, request.botToken));
  if (!bot.isBot) {
    throw new SlackApiError('not_bot_token', 'That token is not a bot token (xoxb-).');
  }
  const user = request.userToken ? await slackAuthTest(clientFor(deps, request.userToken)) : null;
  if (user && user.teamId !== bot.teamId) {
    throw new SlackApiError(
      'team_mismatch',
      'The user token belongs to a different Slack workspace than the bot token.',
    );
  }
  if (request.appToken) {
    await slackCall(clientFor(deps, request.appToken), 'apps.connections.open');
  }
  return { bot, user };
}

async function storeTokens(deps: SlackDeps, request: SaveSlackConnectionRequest): Promise<void> {
  await deps.secrets.set('slack:bot', request.botToken);
  const optional: [SlackSecretId, string | undefined][] = [
    ['slack:user', request.userToken],
    ['slack:app', request.appToken],
  ];
  for (const [id, token] of optional) {
    if (token) await deps.secrets.set(id, token);
    else await deps.secrets.delete(id).catch(() => undefined);
  }
}

export const SWITCH_TO_OWN_APP =
  'Slack is connected by sign-in. Confirm the switch to use your own Slack app instead.';

async function endSignIn(deps: SlackDeps): Promise<void> {
  const token = await savedSlackSignInToken(deps);
  if (token) await slackCall(clientFor(deps, token), 'auth.revoke').catch(() => undefined);
  await forgetSlackSignIn(deps);
}

export async function saveSlack(
  deps: SlackDeps,
  request: SaveSlackConnectionRequest,
  options: { replace?: boolean } = {},
): Promise<SlackStatus> {
  const before = await getSlackConnection(deps.db, deps.workspaceId);
  const switching = before?.method === 'sign_in';
  if (switching && !options.replace) throw new SlackApiError('method_switch', SWITCH_TO_OWN_APP);
  let who: Awaited<ReturnType<typeof validated>>;
  try {
    who = await validated(deps, request);
  } catch (error) {
    await recordSlackEvent(deps.db, deps.workspaceId, {
      action: 'connect',
      outcome: 'failed',
      detail: { error: (error as Error).message },
    });
    throw error;
  }
  if (before && before.teamId !== who.bot.teamId) {
    await deleteSlackConnection(deps.db, deps.workspaceId);
  }
  if (switching) await endSignIn(deps);
  await storeTokens(deps, request);
  const member = who.user
    ? {
        id: who.user.userId,
        name: await slackMemberName(clientFor(deps, request.botToken), who.user.userId).catch(
          () => who.user!.user,
        ),
      }
    : null;
  await saveSlackConnection(deps.db, deps.workspaceId, {
    teamId: who.bot.teamId,
    teamName: who.bot.team,
    teamUrl: who.bot.url,
    botUserId: who.bot.userId,
    botName: who.bot.user,
    member,
    userScopes: who.user?.scopes ?? null,
  });
  await recordSlackEvent(deps.db, deps.workspaceId, {
    action: 'connect',
    outcome: 'succeeded',
    detail: {
      team: who.bot.team,
      method: 'own_app',
      replaced: switching ? 'sign_in' : null,
      userToken: Boolean(request.userToken),
      appToken: Boolean(request.appToken),
    },
  });
  return slackStatus(deps);
}

export async function removeSlack(deps: SlackDeps): Promise<SlackStatus> {
  await endSignIn(deps);
  await deleteSlackConnection(deps.db, deps.workspaceId);
  for (const id of SLACK_SECRET_IDS) await deps.secrets.delete(id).catch(() => undefined);
  await recordSlackEvent(deps.db, deps.workspaceId, { action: 'disconnect', outcome: 'succeeded' });
  return { connection: null, signInAvailable: Boolean(deps.signIn) };
}

export async function refreshSlackScopes(deps: SlackDeps): Promise<void> {
  const open = await requireSlack(deps);
  if (!open.user) return;
  const { scopes } = await slackAnswer(open.user, 'auth.test');
  await saveSlackUserScopes(deps.db, deps.workspaceId, scopes);
}

async function directMessageChoice(
  deps: SlackDeps,
  open: OpenSlack,
  update: Pick<UpdateSlackSettingsRequest, 'readDirectMessages' | 'allDirectMessages'>,
): Promise<{ readDirectMessages: boolean; allDirectMessages: boolean }> {
  const current = open.connection.settings;
  const on = update.readDirectMessages ?? current.readDirectMessages;
  if (!on) {
    if (current.readDirectMessages) await replaceAllowedSlackDms(deps.db, deps.workspaceId, []);
    return { readDirectMessages: false, allDirectMessages: false };
  }
  if (update.readDirectMessages) {
    const scopes = await slackUserScopes(deps, open.connection, open.tokens.user);
    const { blockedBy } = directMessagesBlock(open.user !== null, scopes);
    if (blockedBy) {
      throw new SlackApiError(
        'direct_messages_unavailable',
        blockedBy === 'scopes'
          ? directMessagesScopeMessage(open.connection)
          : DIRECT_MESSAGES_NEED_USER_TOKEN,
      );
    }
  }
  return {
    readDirectMessages: true,
    allDirectMessages: update.allDirectMessages ?? current.allDirectMessages,
  };
}

export async function changeSlackSettings(
  deps: SlackDeps,
  update: UpdateSlackSettingsRequest,
): Promise<SlackStatus> {
  const open = await requireSlack(deps);
  const { memberId, notify, ...rest } = update;
  const signedIn = open.connection.method === 'sign_in';
  if (signedIn && (memberId !== undefined || Boolean(rest.notifyChannelId))) {
    throw new SlackApiError(
      'needs_own_app',
      `With Slack sign-in, notifications go to you. Another member or a channel needs ${NEEDS_OWN_APP}.`,
    );
  }
  if (memberId !== undefined) {
    const member =
      memberId === null ? null : { id: memberId, name: await slackMemberName(open.main, memberId) };
    await saveSlackMember(deps.db, deps.workspaceId, member);
  }
  const allowed = new Set(
    (await allowedSlackChannels(deps.db, deps.workspaceId)).map((channel) => channel.id),
  );
  for (const channelId of [rest.notifyChannelId, rest.defaultChannelId]) {
    if (channelId && !allowed.has(channelId)) {
      throw new SlackChannelNotAllowedError({ id: channelId, name: null });
    }
  }
  const current = open.connection.settings;
  const direct = await directMessageChoice(deps, open, rest);
  const defined = (values: object) =>
    Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  await saveSlackSettings(
    deps.db,
    deps.workspaceId,
    slackSettingsSchema.parse({
      ...current,
      ...defined(rest),
      ...direct,
      notify: { ...current.notify, ...defined(notify ?? {}) },
    }),
  );
  await recordSlackEvent(deps.db, deps.workspaceId, {
    action: 'settings',
    outcome: 'succeeded',
    detail: { changed: Object.keys(update) },
  });
  return slackStatus(deps);
}
