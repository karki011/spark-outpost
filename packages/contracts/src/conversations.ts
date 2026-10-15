import { z } from 'zod';
import { browserShotSchema } from './browser.ts';
import { commandRunSchema } from './command-runs.ts';
import { adviceSummarySchema } from './advice.ts';
import { ANNOTATIONS_PER_MESSAGE, annotationInputSchema } from './annotations.ts';
import { approvalSchema } from './approvals.ts';
import { ATTACHMENTS_PER_MESSAGE, attachmentSchema } from './attachments.ts';
import { categorySchema, titleSourceSchema } from './categories.ts';
import { chatSettingsSchema } from './chat-settings.ts';
import { compactionSchema, continuationSchema } from './compaction.ts';
import { memberMessageSchema, queuedMessageSchema } from './crew-messages.ts';
import { orchestrationSchema } from './orchestration.ts';
import { conversationPlansSchema } from './plans.ts';
import { teammateTagSchema } from './teammates.ts';
import {
  interruptionChoiceSchema,
  interruptionSchema,
  messageSourceSchema,
  runSchema,
  runStatusSchema,
} from './runs.ts';
import { taskOverviewSchema } from './tasks.ts';
import { railFlagSchema } from './rail-flags.ts';
import { conversationUsageSchema } from './usage.ts';
import { subagentRowSchema } from './subagents.ts';
import {
  nativeTerminalProviderSchema,
  nativeTerminalSessionSchema,
  sessionTypeSchema,
} from './native-terminal.ts';

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

export const attentionKindSchema = z.enum([
  'permission',
  'input',
  'plan',
  'review',
  'stuck',
  'flag',
]);
export type AttentionKind = z.infer<typeof attentionKindSchema>;

export const conversationAttentionSchema = z.object({
  kind: attentionKindSchema,
  title: z.string(),
  agentName: z.string().nullable(),
  provider: z.string().nullable(),
  approvalId: z.uuid().nullable(),
  prFeedback: z.boolean().optional(),
  subagent: z.string().optional(),
});
export type ConversationAttention = z.infer<typeof conversationAttentionSchema>;

export const planProgressSchema = z.object({
  done: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});
export type PlanProgress = z.infer<typeof planProgressSchema>;

export const snippetPartSchema = z.object({ text: z.string(), match: z.boolean() });
export type SnippetPart = z.infer<typeof snippetPartSchema>;

export const searchMatchSchema = z.object({
  messageId: z.uuid(),
  runId: z.uuid().nullable(),
  parts: z.array(snippetPartSchema),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

export const conversationSummarySchema = z.object({
  id: z.uuid(),
  sessionType: sessionTypeSchema.optional(),
  terminal: nativeTerminalSessionSchema.nullable().optional(),
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
      interruptionChoice: interruptionChoiceSchema.nullable().optional(),
      needsYou: z.string().nullable().optional(),
      waitingOn: z.number().int().positive().optional(),
      finishedAt: z.string().nullable().optional(),
    })
    .nullable(),
  archivedAt: z.string().nullable(),
  pinnedAt: z.string().nullable(),
  pinnedOrder: z.number().int().nullable().default(null),
  projectOrder: z.number().int().nullable().default(null),
  unread: z.boolean(),
  needsInput: z.boolean(),
  seenAt: z.string().nullable().optional(),
  waitingSince: z.string().nullable().optional(),
  attention: conversationAttentionSchema.nullable().default(null),
  titleSource: titleSourceSchema.default('message'),
  category: categorySchema.nullable().default(null),
  branch: z.string().nullable().optional(),
  teammate: teammateTagSchema.nullable().optional(),
  pullRequestMerged: z.boolean().optional(),
  outpost: z.object({ id: z.uuid(), name: z.string(), handle: z.string() }).optional(),
  match: searchMatchSchema.optional(),
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

export const activityStepSchema = z.object({
  name: z.string(),
  done: z.boolean(),
  reasoningId: z.string().optional(),
  subagent: z.boolean().optional(),
});
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
  compactions: z.array(compactionSchema).optional(),
  continuedIn: z.array(continuationSchema).optional(),
  queue: z.array(queuedMessageSchema).optional(),
  memberMessages: z.array(memberMessageSchema).optional(),
  railFlags: z.array(railFlagSchema).optional(),
  browserShots: z.array(browserShotSchema).optional(),
  commands: z.array(commandRunSchema).optional(),
  interruption: interruptionSchema.nullable().optional(),
  subagents: z.record(z.string(), z.array(subagentRowSchema)).optional(),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;

export const createConversationRequestSchema = z.object({
  id: z.uuid(),
  sessionType: sessionTypeSchema.optional(),
  terminalProvider: nativeTerminalProviderSchema.optional(),
  projectIds: z.array(z.uuid()).max(20).optional(),
  title: z.string().trim().min(1).max(100).optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const sendMessageRequestSchema = z
  .object({
    id: z.uuid(),
    content: z.string().trim(),
    attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_MESSAGE).default([]),
    annotations: z.array(annotationInputSchema).max(ANNOTATIONS_PER_MESSAGE).default([]),
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
