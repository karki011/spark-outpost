import { z } from 'zod';
import { ANNOTATIONS_PER_MESSAGE, annotationInputSchema } from './annotations.ts';
import { ATTACHMENTS_PER_MESSAGE } from './attachments.ts';
import { queuedMessageSchema } from './crew-messages.ts';

export const QUEUE_LIMIT = 50;

export const queueAddRequestSchema = z
  .object({
    id: z.uuid(),
    content: z.string().trim(),
    annotations: z.array(annotationInputSchema).max(ANNOTATIONS_PER_MESSAGE).optional(),
    origin: z.enum(['voice', 'pages']).optional(),
    attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_MESSAGE).optional(),
  })
  .refine((request) => request.content.length > 0 || Boolean(request.attachmentIds?.length), {
    message: 'Write a message or attach a file.',
    path: ['content'],
  });
export type QueueAddRequest = z.infer<typeof queueAddRequestSchema>;

export const queueEditRequestSchema = z.object({
  content: z.string().trim(),
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
