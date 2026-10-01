import { z } from 'zod';

export const COMPACT_WARN_PERCENT = 70;
export const COMPACT_AT_PERCENT = 85;
export const COMPACT_SNOOZED_PERCENT = 95;

export const compactionMethodSchema = z.enum(['agent', 'spark', 'agent-auto']);
export type CompactionMethod = z.infer<typeof compactionMethodSchema>;

export const compactionSchema = z.object({
  id: z.uuid(),
  runId: z.uuid().nullable(),
  method: compactionMethodSchema,
  tokensBefore: z.number().int().nullable(),
  tokensAfter: z.number().int().nullable(),
  contextSize: z.number().int().nullable(),
  summary: z.string().nullable(),
  fromConversationId: z.uuid().nullable(),
  fromTitle: z.string().nullable(),
  createdAt: z.string(),
});
export type Compaction = z.infer<typeof compactionSchema>;

export const continuationSchema = z.object({
  conversationId: z.uuid(),
  title: z.string(),
  runId: z.uuid().nullable(),
});
export type Continuation = z.infer<typeof continuationSchema>;
