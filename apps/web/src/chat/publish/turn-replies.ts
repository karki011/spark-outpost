import type { Message } from '@spark-outpost/contracts';
import type { ReplyStream } from './reply-stream.ts';

export interface StoredReplies {
  reply: string | undefined;
  later: readonly Message[];
}

export interface TurnReplies {
  text: string;
  publishText: string;
}

export function turnReplies(
  stream: Pick<ReplyStream, 'text' | 'publishText'>,
  stored: StoredReplies,
  streamLeads: boolean,
): TurnReplies {
  if (streamLeads || !stored.reply) return { text: stream.text, publishText: stream.publishText };
  return {
    text: stored.reply,
    publishText: stored.later.map((message) => message.content).join('\n\n'),
  };
}

interface Started {
  id: string;
  startedAt: string;
}

export interface PublishStart {
  streamed: readonly { id: string }[];
  streamedBeforePublish: number | null;
  replyClosedAt: string | null;
}

export function splitAtPublish<Item extends Started>(
  items: readonly Item[],
  start: PublishStart,
): { reply: Item[]; publish: Item[] } {
  const streamedInPublish = new Set(
    start.streamedBeforePublish === null
      ? []
      : start.streamed.slice(start.streamedBeforePublish).map((item) => item.id),
  );
  const closedAt = start.replyClosedAt === null ? null : Date.parse(start.replyClosedAt);
  const inPublish = (item: Item) =>
    streamedInPublish.has(item.id) || (closedAt !== null && Date.parse(item.startedAt) > closedAt);
  return {
    reply: items.filter((item) => !inPublish(item)),
    publish: items.filter(inPublish),
  };
}

export function copiedReply(replies: TurnReplies): string {
  return [replies.text, replies.publishText].filter((part) => part.trim() !== '').join('\n\n');
}
