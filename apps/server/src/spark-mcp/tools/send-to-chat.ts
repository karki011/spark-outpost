import {
  parseChatReference,
  type ChatAskDelivered,
  type SendToChatAction,
} from '@spark-outpost/contracts';
import { newId } from '../../persistence/ids.ts';
import {
  AskError,
  recordReply,
  sendRule,
  storedMessage,
  targetChat,
  turnStart,
  waitingAskFor,
  type SendRule,
} from '../../sub-chats/asks.ts';
import { deliverAsk } from '../../sub-chats/delivery.ts';
import { chatTarget } from '../../workflow/queue-drain.ts';
import { userAskedToSend } from '../actions/action-policy.ts';
import { deviceRefusal } from '../actions/ask-spark-limits.ts';
import { actionRun, auditAction, proposeAction, type ProposeOptions } from '../actions/confirm.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';

export interface SendToChatArgs {
  chat?: string | undefined;
  message: string;
  reply?: boolean | undefined;
  replyTo?: string | undefined;
}

const NO_CHAT = 'Pass the chat id or chat link from spark_chats.';

const DELIVERED_NOTES: Record<ChatAskDelivered, string> = {
  steered: 'That chat is working, so the message was handed to its running turn.',
  started: 'The message started a turn in that chat.',
  queued: 'The message waits in that chat’s queue until the chat is free to take it.',
};

const REPLY_NOTE =
  'Its reply arrives later as a message in this chat. Do not wait for it or poll; go on or end your turn.';

const HOW_ALLOWED: Record<Exclude<SendRule['kind'], 'refuse'>, string> = {
  mode: 'mode',
  asked: 'your message asked',
  card: 'card',
};

function proposal(rule: Exclude<SendRule['kind'], 'refuse'>): ProposeOptions {
  const audit = { allowedBy: HOW_ALLOWED[rule] };
  if (rule === 'card') return { alwaysAsk: true, audit };
  return rule === 'asked' ? { path: 'perform', audit } : { audit };
}

async function ownTitle(context: SparkToolContext, chatId: string): Promise<string> {
  const { rows } = await context.deps.db.query<{ title: string }>(
    'SELECT title FROM conversations WHERE id = $1',
    [chatId],
  );
  return rows[0]?.title ?? '';
}

async function answer(context: SparkToolContext, chatId: string, args: SendToChatArgs) {
  const { db } = context.deps;
  const run = actionRun(context.scope);
  try {
    const ask = await waitingAskFor(db, args.replyTo ?? '', chatId);
    const end = await recordReply(db, ask, { fromRunId: run.runId, body: args.message });
    if (!end.settled) throw new AskError('That message is no longer waiting for a reply.');
    run.hooks.audit?.message('harness', {
      method: 'spark/chat_ask',
      params: { askId: ask.id, event: 'reply', from: ask.from, to: ask.to, how: 'replyTo' },
    });
    const delivered = end.replyId ? await deliverAsk(db, end.replyId, chatTarget(db)) : null;
    return {
      outcome: 'done',
      ...(delivered ? { delivered } : {}),
      message: delivered
        ? `Replied to “${ask.from.title}”. ${DELIVERED_NOTES[delivered]}`
        : 'The reply was recorded, but the chat that asked no longer exists.',
    };
  } catch (error) {
    if (error instanceof AskError) throw new SparkToolError(error.message);
    throw error;
  }
}

export async function sendFromChat(context: SparkToolContext, args: SendToChatArgs) {
  const { db } = context.deps;
  const { workspaceId, conversationId, runId } = context.scope;
  if (!conversationId || !runId) throw new SparkToolError('Only a chat can send a message.');
  if (args.replyTo) return answer(context, conversationId, args);
  const toId = args.chat ? parseChatReference(args.chat) : null;
  if (!toId) throw new SparkToolError(NO_CHAT);
  const to = await targetChat(db, workspaceId, conversationId, toId);
  const rule = sendRule({
    fromChatId: conversationId,
    to,
    startedBy: await turnStart(db, runId),
    userAsked: to ? await userAskedToSend(db, runId, to.title) : false,
  });
  const action: SendToChatAction = {
    action: 'send_to_chat',
    askId: newId(),
    from: { id: conversationId, title: await ownTitle(context, conversationId) },
    to: { id: toId, title: to?.title ?? '' },
    message: storedMessage(args.message),
    reply: args.reply === true,
  };
  const refusal =
    rule.kind === 'refuse' ? rule.reason : await deviceRefusal(db, workspaceId, runId, action);
  if (refusal || rule.kind === 'refuse') {
    auditAction(actionRun(context.scope), action, { outcome: 'refused', reason: refusal });
    throw new SparkToolError(refusal ?? NO_CHAT);
  }
  return proposeAction(context, action, proposal(rule.kind));
}

export function sentMessage(action: SendToChatAction, delivered: ChatAskDelivered): string {
  const sent = action.reply ? `Asked “${action.to.title}”.` : `Sent to “${action.to.title}”.`;
  return `${sent} ${DELIVERED_NOTES[delivered]}${action.reply ? ` ${REPLY_NOTE}` : ''}`;
}
