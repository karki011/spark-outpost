import { SLACK_POST_TEXT_MAX, escapeSlackText, slackPlaceLabel } from '@spark-outpost/contracts';
import { redactText } from '../audit/redact.ts';
import { recordSlackEvent } from '../persistence/slack.ts';
import { requirePostablePlace } from './access.ts';
import { requireSlack, type OpenSlack, type SlackDeps } from './connection.ts';
import { slackCall, slackText } from './web-api.ts';

const CHANNEL_SPACING_MS = 1_100;
const nextSlot = new Map<string, number>();

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function paced(channel: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(channel) ?? 0);
  nextSlot.set(channel, at + CHANNEL_SPACING_MS);
  if (at > now) await sleep(at - now);
}

export function slackSafeText(text: string): string {
  return escapeSlackText(redactText(text)).slice(0, SLACK_POST_TEXT_MAX);
}

export interface SlackSent {
  channel: string;
  ts: string;
}

export async function sendSlackMessage(
  deps: SlackDeps,
  open: OpenSlack,
  message: { channel: string; mrkdwn: string; threadTs?: string | null },
): Promise<SlackSent> {
  await paced(message.channel, deps.sleep ?? pause);
  const data = await slackCall(open.bot, 'chat.postMessage', {
    channel: message.channel,
    text: message.mrkdwn,
    thread_ts: message.threadTs ?? undefined,
    unfurl_links: false,
    unfurl_media: false,
  });
  return { channel: slackText(data.channel) || message.channel, ts: slackText(data.ts) };
}

export interface SlackPost {
  channelId: string;
  threadTs: string | null;
  text: string;
  conversationId?: string | null;
  via: string;
}

export async function postToSlack(
  deps: SlackDeps,
  post: SlackPost,
): Promise<{ place: string; permalink: string | null }> {
  const open = await requireSlack(deps);
  const channel = await requirePostablePlace(deps, open, post.channelId);
  const event = {
    action: 'post' as const,
    channelId: channel.id,
    conversationId: post.conversationId ?? null,
  };
  try {
    const sent = await sendSlackMessage(deps, open, {
      channel: channel.id,
      mrkdwn: slackSafeText(post.text),
      threadTs: post.threadTs,
    });
    await recordSlackEvent(deps.db, deps.workspaceId, {
      ...event,
      outcome: 'succeeded',
      detail: { via: post.via, length: post.text.length, thread: post.threadTs !== null },
    });
    const link = await slackCall(open.bot, 'chat.getPermalink', {
      channel: sent.channel,
      message_ts: sent.ts,
    }).catch(() => null);
    return { place: slackPlaceLabel(channel), permalink: slackText(link?.permalink) || null };
  } catch (error) {
    await recordSlackEvent(deps.db, deps.workspaceId, {
      ...event,
      outcome: 'failed',
      detail: { via: post.via, error: (error as Error).message },
    });
    throw error;
  }
}
