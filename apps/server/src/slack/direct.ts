import type {
  AllowSlackDmsRequest,
  SlackDm,
  SlackDmPage,
  SlackStatus,
} from '@spark-outpost/contracts';
import { allowedSlackDms, recordSlackEvent, replaceAllowedSlackDms } from '../persistence/slack.ts';
import type { RawConversation } from './channels.ts';
import {
  DIRECT_MESSAGES_NEED_SCOPES,
  DIRECT_MESSAGES_NEED_USER_TOKEN,
  directMessagesBlock,
  requireSlack,
  slackStatus,
  slackUserScopes,
  type OpenSlack,
  type SlackDeps,
} from './connection.ts';
import { SlackApiError, slackCall, slackText, type SlackClient } from './web-api.ts';

const PAGE_SIZE = 50;
const NAME_LOOKUPS_AT_ONCE = 10;

export const DIRECT_MESSAGES_OFF =
  'Spark doesn\'t read direct messages unless you turn on "Let Spark read my direct messages" in Settings → Connectors → Slack.';

export async function requireDirectMessages(
  deps: SlackDeps,
  open: OpenSlack,
): Promise<SlackClient> {
  if (!open.connection.settings.readDirectMessages) {
    throw new SlackApiError('direct_messages_off', DIRECT_MESSAGES_OFF);
  }
  const scopes = await slackUserScopes(deps, open.connection, open.tokens.user);
  const { blockedBy } = directMessagesBlock(open.user !== null, scopes);
  if (blockedBy === 'scopes') {
    throw new SlackApiError('direct_messages_unavailable', DIRECT_MESSAGES_NEED_SCOPES);
  }
  if (!open.user) {
    throw new SlackApiError('direct_messages_unavailable', DIRECT_MESSAGES_NEED_USER_TOKEN);
  }
  return open.user;
}

export function slackGroupName(raw: string): string {
  const people = raw
    .replace(/^mpdm-/, '')
    .replace(/-\d+$/, '')
    .split('--')
    .filter(Boolean);
  return people.length > 0 ? people.join(', ') : raw;
}

async function personName(open: OpenSlack, userId: string): Promise<string> {
  const data = await slackCall(open.bot, 'users.info', { user: userId }).catch(() => null);
  const user = (data?.user ?? {}) as { real_name?: unknown; name?: unknown };
  const name = slackText(user.real_name) || slackText(user.name) || userId;
  return userId === open.connection.memberId ? `${name} (you)` : name;
}

async function toDm(open: OpenSlack, raw: RawConversation): Promise<SlackDm | null> {
  const id = slackText(raw.id);
  if (!id || raw.is_user_deleted === true || raw.is_archived === true) return null;
  if (raw.is_mpim === true) {
    return { id, kind: 'mpim', name: slackGroupName(slackText(raw.name) || id) };
  }
  const userId = slackText(raw.user);
  if (raw.is_im !== true || !userId) return null;
  return { id, kind: 'im', name: await personName(open, userId) };
}

async function toDms(open: OpenSlack, raw: readonly RawConversation[]): Promise<SlackDm[]> {
  const found: SlackDm[] = [];
  for (let start = 0; start < raw.length; start += NAME_LOOKUPS_AT_ONCE) {
    const batch = raw.slice(start, start + NAME_LOOKUPS_AT_ONCE);
    const named = await Promise.all(batch.map((entry) => toDm(open, entry)));
    found.push(...named.filter((entry): entry is SlackDm => entry !== null));
  }
  return found;
}

export async function listSlackDms(deps: SlackDeps, cursor: string | null): Promise<SlackDmPage> {
  const open = await requireSlack(deps);
  const user = await requireDirectMessages(deps, open);
  const data = await slackCall(user, 'conversations.list', {
    types: 'im,mpim',
    exclude_archived: true,
    limit: PAGE_SIZE,
    cursor: cursor ?? undefined,
  });
  const raw = Array.isArray(data.channels) ? (data.channels as RawConversation[]) : [];
  const next = slackText((data.response_metadata as { next_cursor?: unknown })?.next_cursor);
  return { conversations: await toDms(open, raw), nextCursor: next || null };
}

export async function slackDmInfo(
  open: OpenSlack,
  user: SlackClient,
  channelId: string,
): Promise<SlackDm> {
  const data = await slackCall(user, 'conversations.info', { channel: channelId });
  const dm = await toDm(open, (data.channel ?? {}) as RawConversation);
  if (!dm) {
    throw new SlackApiError('not_direct_message', "Slack can't find that direct message.");
  }
  return dm;
}

export async function allowSlackDms(
  deps: SlackDeps,
  request: AllowSlackDmsRequest,
): Promise<SlackStatus> {
  const open = await requireSlack(deps);
  const user = await requireDirectMessages(deps, open);
  const known = new Map(
    (await allowedSlackDms(deps.db, deps.workspaceId)).map((entry) => [entry.id, entry]),
  );
  const next: SlackDm[] = [];
  for (const { id } of request.conversations) {
    next.push(known.get(id) ?? (await slackDmInfo(open, user, id)));
  }
  await replaceAllowedSlackDms(deps.db, deps.workspaceId, next);
  await recordSlackEvent(deps.db, deps.workspaceId, {
    action: 'direct_messages',
    outcome: 'succeeded',
    detail: { allowed: next.map((entry) => ({ id: entry.id, kind: entry.kind })) },
  });
  return slackStatus(deps);
}

export async function allowOneSlackDm(deps: SlackDeps, channelId: string): Promise<SlackStatus> {
  const current = await allowedSlackDms(deps.db, deps.workspaceId);
  if (current.some((entry) => entry.id === channelId)) return slackStatus(deps);
  return allowSlackDms(deps, {
    conversations: [...current.map((entry) => ({ id: entry.id })), { id: channelId }],
  });
}
