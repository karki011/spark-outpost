import { z } from 'zod';
import { attachmentSchema } from './attachments.ts';
import type { ConversationSummary } from './conversations.ts';
import { SPARK_URL_SCHEME } from './slack.ts';

export const CHAT_SHARE_STATES = ['working', 'needs_you', 'failed', 'done', 'idle'] as const;
export const chatShareStateSchema = z.enum(CHAT_SHARE_STATES);
export type ChatShareState = z.infer<typeof chatShareStateSchema>;

export const chatShareStateLabels: Record<ChatShareState, string> = {
  working: 'Running',
  needs_you: 'Waiting for you',
  failed: 'Stopped with an error',
  done: 'Done',
  idle: 'Not started',
};

export function chatShareState(
  chat: Pick<ConversationSummary, 'needsInput' | 'attention' | 'latestRun'>,
): ChatShareState {
  if (chat.needsInput || chat.attention) return 'needs_you';
  const status = chat.latestRun?.status;
  if (status === 'queued' || status === 'running' || status === 'awaiting_approval') {
    return 'working';
  }
  if (status === 'failed' || status === 'outcome_unknown') return 'failed';
  if (status === 'succeeded' || status === 'cancelled') return 'done';
  return 'idle';
}

const CHAT_ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CHAT_LINK = new RegExp(`^${SPARK_URL_SCHEME}(?:-[a-z0-9]+)*://chat/(${CHAT_ID})/?$`);
const BARE_CHAT_ID = new RegExp(`^${CHAT_ID}$`);

export const CHAT_REFERENCE_MAX_LENGTH = 200;

export function chatIdFromLink(raw: string): string | null {
  return CHAT_LINK.exec(raw.trim().toLowerCase())?.[1] ?? null;
}

export function parseChatReference(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  return BARE_CHAT_ID.test(text) ? text : chatIdFromLink(text);
}

export const chatLinkResponseSchema = z.object({ id: z.uuid(), link: z.string() });
export type ChatLinkResponse = z.infer<typeof chatLinkResponseSchema>;

export const chatContextRequestSchema = z.object({
  reference: z.string().trim().min(1).max(CHAT_REFERENCE_MAX_LENGTH),
});

export const chatSharePreviewSchema = z.object({
  id: z.uuid(),
  link: z.string(),
  title: z.string(),
  projects: z.array(z.string()),
  state: chatShareStateSchema,
  archived: z.boolean(),
  asOf: z.string(),
});
export type ChatSharePreview = z.infer<typeof chatSharePreviewSchema>;

export const chatContextResponseSchema = z.object({
  attachment: attachmentSchema,
  preview: chatSharePreviewSchema,
});
export type ChatContextResponse = z.infer<typeof chatContextResponseSchema>;
