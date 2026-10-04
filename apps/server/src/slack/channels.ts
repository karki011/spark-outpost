import type {
  AllowSlackChannelsRequest,
  SlackAllowedChannel,
  SlackChannel,
  SlackChannelPage,
  SlackStatus,
} from '@spark-outpost/contracts';
import {
  allowedSlackChannels,
  recordSlackEvent,
  replaceAllowedSlackChannels,
  saveSlackSettings,
} from '../persistence/slack.ts';
import { requireSlack, slackStatus, type OpenSlack, type SlackDeps } from './connection.ts';
import { SlackApiError, slackCall, slackText } from './web-api.ts';

const PAGE_SIZE = 200;

export interface RawConversation {
  id?: unknown;
  name?: unknown;
  is_private?: unknown;
  is_member?: unknown;
  is_archived?: unknown;
  is_im?: unknown;
  is_mpim?: unknown;
  user?: unknown;
  is_user_deleted?: unknown;
}

export const isDirectConversation = (raw: RawConversation): boolean =>
  raw.is_im === true || raw.is_mpim === true;

function toChannel(raw: RawConversation): SlackChannel | null {
  const id = slackText(raw.id);
  const name = slackText(raw.name);
  if (!id || !name || raw.is_archived === true || isDirectConversation(raw)) return null;
  return { id, name, isPrivate: raw.is_private === true, isMember: raw.is_member === true };
}

export async function listSlackChannels(
  deps: SlackDeps,
  cursor: string | null,
): Promise<SlackChannelPage> {
  const open = await requireSlack(deps);
  const data = await slackCall(open.user ?? open.bot, 'conversations.list', {
    types: 'public_channel,private_channel',
    exclude_archived: true,
    limit: PAGE_SIZE,
    cursor: cursor ?? undefined,
  });
  const raw = Array.isArray(data.channels) ? (data.channels as RawConversation[]) : [];
  const next = slackText((data.response_metadata as { next_cursor?: unknown })?.next_cursor);
  return {
    channels: raw.map(toChannel).filter((channel): channel is SlackChannel => channel !== null),
    nextCursor: next || null,
  };
}

export async function slackConversation(
  open: OpenSlack,
  channelId: string,
): Promise<RawConversation> {
  const lookup = (client: OpenSlack['bot']) =>
    slackCall(client, 'conversations.info', { channel: channelId });
  const data = await lookup(open.bot).catch((error: unknown) => {
    if (!open.user) throw error;
    return lookup(open.user);
  });
  return (data.channel ?? {}) as RawConversation;
}

async function slackChannelInfo(open: OpenSlack, channelId: string): Promise<SlackChannel> {
  const channel = toChannel(await slackConversation(open, channelId));
  if (!channel) throw new SlackApiError('channel_not_found', "Slack can't find that channel.");
  return channel;
}

export async function allowSlackChannels(
  deps: SlackDeps,
  request: AllowSlackChannelsRequest,
): Promise<SlackStatus> {
  const open = await requireSlack(deps);
  const known = new Map(
    (await allowedSlackChannels(deps.db, deps.workspaceId)).map((channel) => [channel.id, channel]),
  );
  const next: SlackAllowedChannel[] = [];
  for (const entry of request.channels) {
    const existing = known.get(entry.id);
    const info = existing ?? (await slackChannelInfo(open, entry.id));
    next.push({
      id: entry.id,
      name: info.name,
      isPrivate: info.isPrivate,
      projectId: entry.projectId,
    });
  }
  await replaceAllowedSlackChannels(deps.db, deps.workspaceId, next);
  const kept = new Set(next.map((channel) => channel.id));
  const { settings } = open.connection;
  const stillAllowed = (id: string | null) => (id && kept.has(id) ? id : null);
  await saveSlackSettings(deps.db, deps.workspaceId, {
    ...settings,
    notifyChannelId: stillAllowed(settings.notifyChannelId),
    defaultChannelId: stillAllowed(settings.defaultChannelId),
  });
  await recordSlackEvent(deps.db, deps.workspaceId, {
    action: 'channels',
    outcome: 'succeeded',
    detail: { allowed: next.map((channel) => channel.id) },
  });
  return slackStatus(deps);
}

export async function allowOneSlackChannel(
  deps: SlackDeps,
  channelId: string,
): Promise<SlackStatus> {
  const current = await allowedSlackChannels(deps.db, deps.workspaceId);
  if (current.some((channel) => channel.id === channelId)) return slackStatus(deps);
  return allowSlackChannels(deps, {
    channels: [
      ...current.map((channel) => ({ id: channel.id, projectId: channel.projectId })),
      { id: channelId, projectId: null },
    ],
  });
}
