import { z } from 'zod';
import { adviceSummarySchema } from './advice.ts';
import { ANNOTATIONS_PER_MESSAGE, annotationInputSchema } from './annotations.ts';
import { approvalSchema } from './approvals.ts';
import { ATTACHMENTS_PER_MESSAGE, attachmentSchema } from './attachments.ts';
import { categorySchema, titleSourceSchema } from './categories.ts';
import { chatSettingsSchema } from './chat-settings.ts';
import { orchestrationSchema } from './orchestration.ts';
import { conversationPlansSchema } from './plans.ts';
import { messageSourceSchema, runSchema, runStatusSchema, startAsSchema } from './runs.ts';
import { taskOverviewSchema } from './tasks.ts';
import { conversationUsageSchema } from './usage.ts';

export const MESSAGE_MAX_LENGTH = 20_000;
export const TITLE_MAX_LENGTH = 40;
export const UNTITLED_CONVERSATION = 'New chat';

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  runId: z.uuid().nullable(),
  createdAt: z.string(),
  attachments: z.array(attachmentSchema),
});
export type Message = z.infer<typeof messageSchema>;

export const attentionKindSchema = z.enum(['permission', 'input', 'plan', 'review', 'stuck']);
export type AttentionKind = z.infer<typeof attentionKindSchema>;

export const conversationAttentionSchema = z.object({
  kind: attentionKindSchema,
  title: z.string(),
  agentName: z.string().nullable(),
  provider: z.string().nullable(),
  approvalId: z.uuid().nullable(),
});
export type ConversationAttention = z.infer<typeof conversationAttentionSchema>;

export const planProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});
export type PlanProgress = z.infer<typeof planProgressSchema>;

export const conversationSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.string(),
  projectIds: z.array(z.uuid()),
  latestRun: z
    .object({
      id: z.uuid(),
      status: runStatusSchema,
      error: z.string().nullable(),
      step: z.string().nullable(),
      provider: z.string().nullable().default(null),
      progress: planProgressSchema.nullable().default(null),
    })
    .nullable(),
  archivedAt: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  pinnedOrder: z.number().int().nullable().default(null),
  projectOrder: z.number().int().nullable().default(null),
  unread: z.boolean(),
  needsInput: z.boolean(),
  attention: conversationAttentionSchema.nullable().default(null),
  titleSource: titleSourceSchema.default('message'),
  category: categorySchema.nullable().default(null),
  branch: z.string().nullable().optional(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const RENAMED_TITLE_MAX_LENGTH = 100;
export const CONVERSATION_SEARCH_MAX_LENGTH = 200;

export const updateConversationRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(RENAMED_TITLE_MAX_LENGTH).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    autoTitle: z.boolean().optional(),
  })
  .refine((update) => Object.values(update).some((value) => value !== undefined), {
    message: 'Change the title, pin, archive, or auto-title state.',
  });
export type UpdateConversationRequest = z.infer<typeof updateConversationRequestSchema>;

export const conversationOrderRequestSchema = z.object({
  conversationIds: z.array(z.uuid()).min(1).max(500),
});
export type ConversationOrderRequest = z.infer<typeof conversationOrderRequestSchema>;

export const activityStepSchema = z.object({ name: z.string(), done: z.boolean() });
export type ActivityStep = z.infer<typeof activityStepSchema>;

export const conversationDetailSchema = z.object({
  conversation: conversationSummarySchema,
  messages: z.array(messageSchema),
  runs: z.array(runSchema),
  activity: z.record(z.string(), z.array(activityStepSchema)),
  settings: chatSettingsSchema,
  usageTotals: conversationUsageSchema,
  tasks: z.array(taskOverviewSchema),
  approvals: z.array(approvalSchema),
  advice: z.record(z.string(), adviceSummarySchema).optional(),
  orchestrations: z.record(z.string(), orchestrationSchema).optional(),
  plans: conversationPlansSchema.optional(),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const createConversationRequestSchema = z.object({
  id: z.uuid(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const sendMessageRequestSchema = z
  .object({
    id: z.uuid(),
    content: z.string().trim().max(MESSAGE_MAX_LENGTH),
    attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_MESSAGE).default([]),
    annotations: z.array(annotationInputSchema).max(ANNOTATIONS_PER_MESSAGE).default([]),
    startAs: startAsSchema.optional(),
    source: messageSourceSchema.optional(),
  })
  .refine((request) => request.content.length > 0 || request.attachmentIds.length > 0, {
    message: 'Write a message or attach a file.',
    path: ['content'],
  });
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.object({
  message: messageSchema,
  run: runSchema,
});
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export function clipAtWord(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const space = trimmed.slice(0, max).lastIndexOf(' ');
  const words = space > max / 2 ? trimmed.slice(0, space) : trimmed.slice(0, max - 1);
  return `${words.trimEnd()}…`;
}

export function titleFromMessage(content: string): string {
  const firstLine = content.trim().split('\n')[0] ?? '';
  return clipAtWord(firstLine, TITLE_MAX_LENGTH) || UNTITLED_CONVERSATION;
}
