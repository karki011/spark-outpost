import { slackSettingsSchema } from '@spark-outpost/contracts';
import type {
  SaveSlackConnectionRequest,
  SlackCapabilities,
  SlackSocketState,
  SlackStatus,
  UpdateSlackSettingsRequest,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import {
  allowedSlackChannels,
  deleteSlackConnection,
  getSlackConnection,
  recordSlackEvent,
  saveSlackConnection,
  saveSlackMember,
  saveSlackSettings,
  type SlackConnectionRow,
} from '../persistence/slack.ts';
import { SLACK_SECRET_IDS, type SecretStore, type SlackSecretId } from '../setup/secrets.ts';
import {
  SlackApiError,
  SlackChannelNotAllowedError,
  SlackNotConnectedError,
  slackCall,
  slackText,
  type SlackClient,
} from './web-api.ts';

export interface SlackDeps {
  db: Db;
  workspaceId: string;
  secrets: SecretStore;
  fetch: typeof fetch;
  slackApiUrl?: string | undefined;
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
  tokens: SlackTokens;
  bot: SlackClient;
  user: SlackClient | null;
}

export async function openSlack(deps: SlackDeps): Promise<OpenSlack | null> {
  const connection = await getSlackConnection(deps.db, deps.workspaceId);
  if (!connection) return null;
  const tokens = await slackTokens(deps);
  if (!tokens) return null;
  return {
    connection,
    tokens,
    bot: clientFor(deps, tokens.bot, connection.botName),
    user: tokens.user ? clientFor(deps, tokens.user, connection.botName) : null,
  };
}

export async function requireSlack(deps: SlackDeps): Promise<OpenSlack> {
  const open = await openSlack(deps);
  if (!open) throw new SlackNotConnectedError();
  return open;
}

function capabilities(
  connection: SlackConnectionRow,
  tokens: { user: boolean; app: boolean },
): SlackCapabilities {
  const { settings } = connection;
  return {
    notify: connection.memberId !== null || settings.notifyChannelId !== null,
    readThreads: true,
    readUnjoined: tokens.user,
    search: tokens.user,
    post: true,
    startFromSlack: tokens.app && settings.startFromSlack,
  };
}

export async function slackStatus(
  deps: SlackDeps,
  socket: SlackSocketState = 'off',
): Promise<SlackStatus> {
  const connection = await getSlackConnection(deps.db, deps.workspaceId);
  const tokens = connection ? await slackTokens(deps) : null;
  if (!connection || !tokens) return { connection: null };
  const present = { bot: true, user: tokens.user !== null, app: tokens.app !== null };
  return {
    connection: {
      team: connection.teamName,
      teamUrl: connection.teamUrl,
      botName: connection.botName,
      member:
        connection.memberId === null
          ? null
          : { id: connection.memberId, name: connection.memberName ?? connection.memberId },
      tokens: present,
      capabilities: capabilities(connection, present),
      validatedAt: connection.validatedAt.toISOString(),
      settings: connection.settings,
      allowedChannels: await allowedSlackChannels(deps.db, deps.workspaceId),
      socket,
      lastProblem:
        connection.problem && connection.problemAt
          ? { message: connection.problem, at: connection.problemAt.toISOString() }
          : null,
    },
  };
}

interface Who {
  teamId: string;
  team: string;
  url: string;
  userId: string;
  user: string;
  isBot: boolean;
}

async function authTest(client: SlackClient): Promise<Who> {
  const data = await slackCall(client, 'auth.test');
  return {
    teamId: slackText(data.team_id),
    team: slackText(data.team),
    url: slackText(data.url),
    userId: slackText(data.user_id),
    user: slackText(data.user),
    isBot: typeof data.bot_id === 'string',
  };
}

async function memberName(client: SlackClient, userId: string): Promise<string> {
  const data = await slackCall(client, 'users.info', { user: userId });
  const user = (data.user ?? {}) as { real_name?: unknown; name?: unknown };
  return slackText(user.real_name) || slackText(user.name) || userId;
}

async function validated(deps: SlackDeps, request: SaveSlackConnectionRequest) {
  const bot = await authTest(clientFor(deps, request.botToken));
  if (!bot.isBot) {
    throw new SlackApiError('not_bot_token', 'That token is not a bot token (xoxb-).');
  }
  const user = request.userToken ? await authTest(clientFor(deps, request.userToken)) : null;
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

export async function saveSlack(
  deps: SlackDeps,
  request: SaveSlackConnectionRequest,
): Promise<SlackStatus> {
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
  const before = await getSlackConnection(deps.db, deps.workspaceId);
  if (before && before.teamId !== who.bot.teamId) {
    await deleteSlackConnection(deps.db, deps.workspaceId);
  }
  await storeTokens(deps, request);
  const member = who.user
    ? {
        id: who.user.userId,
        name: await memberName(clientFor(deps, request.botToken), who.user.userId).catch(
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
  });
  await recordSlackEvent(deps.db, deps.workspaceId, {
    action: 'connect',
    outcome: 'succeeded',
    detail: {
      team: who.bot.team,
      userToken: Boolean(request.userToken),
      appToken: Boolean(request.appToken),
    },
  });
  return slackStatus(deps);
}

export async function removeSlack(deps: SlackDeps): Promise<SlackStatus> {
  await deleteSlackConnection(deps.db, deps.workspaceId);
  for (const id of SLACK_SECRET_IDS) await deps.secrets.delete(id).catch(() => undefined);
  await recordSlackEvent(deps.db, deps.workspaceId, { action: 'disconnect', outcome: 'succeeded' });
  return { connection: null };
}

export async function changeSlackSettings(
  deps: SlackDeps,
  update: UpdateSlackSettingsRequest,
): Promise<SlackStatus> {
  const open = await requireSlack(deps);
  const { memberId, notify, ...rest } = update;
  if (memberId !== undefined) {
    const member =
      memberId === null ? null : { id: memberId, name: await memberName(open.bot, memberId) };
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
  const defined = (values: object) =>
    Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
  await saveSlackSettings(
    deps.db,
    deps.workspaceId,
    slackSettingsSchema.parse({
      ...current,
      ...defined(rest),
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
