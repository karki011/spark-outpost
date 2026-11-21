import { z } from 'zod';
import { chatRefSchema } from './chat-ref.ts';

export const CHAT_MESSAGE_MAX = 20_000;

export const sendToChatActionSchema = z.object({
  action: z.literal('send_to_chat'),
  askId: z.uuid(),
  from: chatRefSchema,
  to: chatRefSchema,
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
  reply: z.boolean(),
});
export type SendToChatAction = z.infer<typeof sendToChatActionSchema>;

export const sendToChatLabels = {
  send_to_chat: {
    question: 'Send this to another chat?',
    confirm: 'Send',
    doing: 'Sending…',
  },
};

export function sendToChatQuestion(action: SendToChatAction): string {
  return action.reply ? `Ask “${action.to.title}” this?` : `Send this to “${action.to.title}”?`;
}

export function sendToChatAuditFacts(action: SendToChatAction) {
  return {
    action: action.action,
    askId: action.askId,
    from: action.from,
    to: action.to,
    reply: action.reply,
  };
}

export const chatAskDeliveredSchema = z.enum(['steered', 'started', 'queued']);
export type ChatAskDelivered = z.infer<typeof chatAskDeliveredSchema>;
