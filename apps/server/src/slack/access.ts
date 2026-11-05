import type { SlackPlaceKind } from '@spark-outpost/contracts';
import { allowedSlackChannel, allowedSlackDm } from '../persistence/slack.ts';
import { isDirectConversation, slackConversation } from './channels.ts';
import type { OpenSlack, SlackDeps } from './connection.ts';
import { requireDirectMessages, slackDmInfo } from './direct.ts';
import { SlackApiError, SlackChannelNotAllowedError, slackText } from './web-api.ts';

const DIRECT_ID = /^D/;

export interface SlackPlace {
  id: string;
  name: string;
  kind: SlackPlaceKind;
}

export const POSTING_IN_ONE_TO_ONE =
  "Spark can't post in a one-to-one direct message: the app isn't in it, and Spark never posts as you.";
export const POSTING_IN_ONE_TO_ONE_AS_YOU =
  'Spark never posts in a one-to-one direct message, even when it posts as you.';

async function directPlace(
  deps: SlackDeps,
  open: OpenSlack,
  id: string,
  kind: 'im' | 'mpim',
): Promise<SlackPlace> {
  const user = await requireDirectMessages(deps, open);
  const allowed = await allowedSlackDm(deps.db, deps.workspaceId, id);
  if (allowed) return allowed;
  if (!open.connection.settings.allDirectMessages) {
    throw new SlackChannelNotAllowedError({ id, name: null, kind });
  }
  return slackDmInfo(open, user, id);
}

export async function requireSlackPlace(
  deps: SlackDeps,
  open: OpenSlack,
  id: string,
): Promise<SlackPlace> {
  const channel = await allowedSlackChannel(deps.db, deps.workspaceId, id);
  if (channel) return { id: channel.id, name: channel.name, kind: 'channel' };
  if (DIRECT_ID.test(id)) return directPlace(deps, open, id, 'im');
  const allowedDm = await allowedSlackDm(deps.db, deps.workspaceId, id);
  if (allowedDm) return directPlace(deps, open, id, allowedDm.kind);
  const raw = await slackConversation(open, id).catch(() => null);
  if (raw && isDirectConversation(raw)) {
    return directPlace(deps, open, id, raw.is_im === true ? 'im' : 'mpim');
  }
  throw new SlackChannelNotAllowedError({ id, name: slackText(raw?.name) || null });
}

export async function requirePostablePlace(
  deps: SlackDeps,
  open: OpenSlack,
  id: string,
): Promise<SlackPlace> {
  const place = await requireSlackPlace(deps, open, id);
  if (place.kind === 'im') {
    throw new SlackApiError(
      'direct_message',
      open.connection.method === 'sign_in' ? POSTING_IN_ONE_TO_ONE_AS_YOU : POSTING_IN_ONE_TO_ONE,
    );
  }
  return place;
}
