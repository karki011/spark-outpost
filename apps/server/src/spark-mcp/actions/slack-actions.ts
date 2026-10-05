import { z } from 'zod';
import { SLACK_POST_TEXT_MAX, type SparkAction } from '@spark-outpost/contracts';
import { redactText } from '../../audit/redact.ts';
import { allowedSlackChannels, allowedSlackDm, slackChatThread } from '../../persistence/slack.ts';
import { requirePostablePlace } from '../../slack/access.ts';
import { requireSlack, type SlackDeps } from '../../slack/connection.ts';
import { postToSlack } from '../../slack/post.ts';
import { requireSlackRef } from '../../slack/thread.ts';
import { SlackChannelNotAllowedError } from '../../slack/web-api.ts';
import { asSlackToolError } from '../tools/slack-tool.ts';
import { slackDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { ACTION_NOTE } from './action-note.ts';
import { proposeAction } from './confirm.ts';
import type { Performed } from './performed.ts';

interface Place {
  channelId: string;
  threadTs: string | null;
  permalink: string | null;
}

async function namedChannel(deps: SlackDeps, wanted: string): Promise<Place> {
  const name = wanted.replace(/^#/, '');
  const allowed = await allowedSlackChannels(deps.db, deps.workspaceId);
  const match = allowed.find((channel) => channel.id === name || channel.name === name);
  const place = match ?? (await allowedSlackDm(deps.db, deps.workspaceId, name));
  if (!place) throw new SlackChannelNotAllowedError({ id: name, name });
  return { channelId: place.id, threadTs: null, permalink: null };
}

async function placeFor(
  deps: SlackDeps,
  conversationId: string | null,
  args: { channel?: string | undefined; threadUrl?: string | undefined },
): Promise<Place> {
  if (args.threadUrl) {
    const ref = requireSlackRef(args.threadUrl);
    return {
      channelId: ref.channelId,
      threadTs: ref.threadTs ?? ref.ts,
      permalink: args.threadUrl,
    };
  }
  if (args.channel) return namedChannel(deps, args.channel);
  const origin = conversationId ? await slackChatThread(deps.db, conversationId) : null;
  if (origin) {
    return { channelId: origin.channelId, threadTs: origin.threadTs, permalink: origin.permalink };
  }
  const open = await requireSlack(deps);
  const fallback = open.connection.settings.defaultChannelId;
  if (!fallback) {
    throw new SparkToolError(
      'Pass channel or threadUrl: no default channel for updates is set in Settings → Connectors → Slack.',
    );
  }
  return { channelId: fallback, threadTs: null, permalink: null };
}

async function propose(
  context: SparkToolContext,
  args: { channel?: string | undefined; threadUrl?: string | undefined; text: string },
) {
  const deps = slackDepsFor(context.deps, context.scope);
  const build = async (): Promise<{ action: SparkAction; alwaysAsk: boolean }> => {
    const open = await requireSlack(deps);
    const place = await placeFor(deps, context.scope.conversationId, args);
    const channel = await requirePostablePlace(deps, open, place.channelId);
    const direct = channel.kind !== 'channel';
    const asYou = open.connection.method === 'sign_in';
    return {
      alwaysAsk: direct || asYou,
      action: {
        action: 'post_slack',
        ...(asYou ? { asYou } : {}),
        channel: {
          id: channel.id,
          name: direct ? `${channel.name} (group message)` : channel.name,
        },
        threadTs: place.threadTs,
        permalink: place.permalink,
        body: redactText(args.text),
      },
    };
  };
  const { action, alwaysAsk } = await asSlackToolError(build());
  return proposeAction(context, action, { alwaysAsk });
}

export async function performPostSlack(
  context: SparkToolContext,
  action: Extract<SparkAction, { action: 'post_slack' }>,
): Promise<Performed> {
  const posted = await postToSlack(slackDepsFor(context.deps, context.scope), {
    channelId: action.channel.id,
    threadTs: action.threadTs,
    text: action.body,
    conversationId: context.scope.conversationId,
    via: 'spark_tools',
  });
  const where = action.threadTs ? `a thread in ${posted.place}` : posted.place;
  return {
    message: `Posted to ${where}.`,
    url: posted.permalink,
    output: { channel: posted.place },
  };
}

export const slackPostTool = sparkTool({
  name: 'spark_slack_post',
  title: 'Post to Slack',
  acts: true,
  needs: 'slack',
  description: `Post a short update, PR link or question to an allowed Slack channel or thread. With the user's own Slack app it posts as that app; with Slack sign-in there is no bot, so it posts as the user, under their name, and always asks them first. An allowed group direct message always asks the user first; one-to-one direct messages are never posted in. Pass channel (name or id) or threadUrl (a message link, to reply in that thread); with neither, Spark uses the thread this chat started from, then the default updates channel. Plain text; mentions and links are not expanded. ${ACTION_NOTE}`,
  input: {
    channel: z.string().trim().min(1).max(120).optional(),
    threadUrl: z.string().trim().max(2000).optional(),
    text: z.string().trim().min(1).max(SLACK_POST_TEXT_MAX),
  },
  run: (args, context) => propose(context, args),
});
