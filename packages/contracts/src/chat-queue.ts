import { z } from 'zod';
import { queuedMessageSchema } from './crew-messages.ts';

export const QUEUE_LIMIT = 50;

export const queueAddRequestSchema = z.object({
  id: z.uuid(),
  content: z.string().trim().min(1),
  origin: z.literal('voice').optional(),
});
export type QueueAddRequest = z.infer<typeof queueAddRequestSchema>;

export const queueEditRequestSchema = z.object({
  content: z.string().trim().min(1),
});
export type QueueEditRequest = z.infer<typeof queueEditRequestSchema>;

export const queueOrderRequestSchema = z.object({
  ids: z.array(z.uuid()).max(QUEUE_LIMIT),
});
export type QueueOrderRequest = z.infer<typeof queueOrderRequestSchema>;

export const sendNowOutcomeSchema = z.enum(['sent', 'steering']);
export type SendNowOutcome = z.infer<typeof sendNowOutcomeSchema>;

export const queueResponseSchema = z.object({
  queue: z.array(queuedMessageSchema),
  outcome: sendNowOutcomeSchema.optional(),
});
export type QueueResponse = z.infer<typeof queueResponseSchema>;
