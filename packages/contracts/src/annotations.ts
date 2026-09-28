import { z } from 'zod';

export const ANNOTATIONS_PER_MESSAGE = 20;
export const ANNOTATION_QUOTE_MAX_LENGTH = 8_000;
export const ANNOTATION_NOTE_MAX_LENGTH = 2_000;
export const ANCHOR_CONTEXT_LENGTH = 32;

export const annotationKindSchema = z.enum(['quote', 'ask', 'comment']);
export type AnnotationKind = z.infer<typeof annotationKindSchema>;

export const textAnchorSchema = z
  .object({
    exact: z.string().min(1).max(ANNOTATION_QUOTE_MAX_LENGTH),
    prefix: z.string().max(ANCHOR_CONTEXT_LENGTH),
    suffix: z.string().max(ANCHOR_CONTEXT_LENGTH),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((anchor) => anchor.end >= anchor.start, {
    message: 'An anchor must end after it starts.',
    path: ['end'],
  });
export type TextAnchor = z.infer<typeof textAnchorSchema>;

export const annotationInputSchema = z.object({
  id: z.uuid(),
  sourceMessageId: z.uuid(),
  kind: annotationKindSchema,
  quote: z.string().trim().min(1).max(ANNOTATION_QUOTE_MAX_LENGTH),
  note: z.string().trim().max(ANNOTATION_NOTE_MAX_LENGTH).default(''),
  anchor: textAnchorSchema,
});
export type AnnotationInput = z.input<typeof annotationInputSchema>;
export type AnnotationRequest = z.output<typeof annotationInputSchema>;

export const messageAnnotationSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  sourceMessageId: z.uuid(),
  messageId: z.uuid(),
  kind: annotationKindSchema,
  quote: z.string(),
  note: z.string(),
  anchor: textAnchorSchema,
  createdAt: z.string(),
});
export type MessageAnnotation = z.infer<typeof messageAnnotationSchema>;

export const annotationListSchema = z.object({
  annotations: z.array(messageAnnotationSchema),
});
export type AnnotationList = z.infer<typeof annotationListSchema>;
