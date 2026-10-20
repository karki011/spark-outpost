import { z } from 'zod';

export const MEMBER_MESSAGE_ACTIVITY = 'member_message';
export const memberMessageStatusSchema = z.enum([
  'queued',
  'delivered',
  'interrupting',
  'sent',
  'missed',
  'continued',
]);
export type MemberMessageStatus = z.infer<typeof memberMessageStatusSchema>;

export const memberMessageUrgencySchema = z.enum(['next', 'now']);
export type MemberMessageUrgency = z.infer<typeof memberMessageUrgencySchema>;

export const memberMessageSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  body: z.string(),
  urgency: memberMessageUrgencySchema,
  status: memberMessageStatusSchema,
  messageId: z.uuid().nullable(),
  createdAt: z.string(),
  deliveredAt: z.string().nullable(),
  deliveredRunId: z.uuid().nullable().optional(),
});
export type MemberMessage = z.infer<typeof memberMessageSchema>;

export const memberMessageRequestSchema = z.object({
  id: z.uuid(),
  text: z.string().trim().min(1),
  continue: z.boolean().default(false),
});
export type MemberMessageRequest = z.infer<typeof memberMessageRequestSchema>;

export const memberMessageResponseSchema = z.object({
  message: memberMessageSchema.nullable(),
  queued: z.boolean(),
  reply: z.string(),
});
export type MemberMessageResponse = z.infer<typeof memberMessageResponseSchema>;

export const queuedMessageSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  position: z.number(),
  continueRunId: z.uuid().nullable(),
  createdAt: z.string(),
  outpostPostId: z.uuid().nullable().optional(),
  sparkRuleCardId: z.uuid().optional(),
});
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;
