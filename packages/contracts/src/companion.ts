import { z } from 'zod';
import { assistantActsSchema } from './ask-spark-action.ts';
import { providerIdSchema } from './provider-ids.ts';

export const CHAT_UPDATE_MAX_LINES = 3;

export const chatUpdateSchema = z.object({
  conversationId: z.uuid(),
  lines: z.array(z.string()).min(1).max(CHAT_UPDATE_MAX_LINES),
  by: z.enum(['jev', 'rules']),
  createdAt: z.string(),
});
export type ChatUpdate = z.infer<typeof chatUpdateSchema>;

export const sparkAssistantSchema = z.object({ conversationId: z.uuid() });
export type SparkAssistant = z.infer<typeof sparkAssistantSchema>;

export const assistantModelChoiceSchema = z.enum(['fast', 'default', 'pick']);
export type AssistantModelChoice = z.infer<typeof assistantModelChoiceSchema>;

export const assistantSettingsSchema = z.object({
  provider: providerIdSchema.nullable(),
  modelChoice: assistantModelChoiceSchema,
  model: z.string().min(1).max(200).nullable(),
  effort: z.string().min(1).max(40).nullable(),
  acts: assistantActsSchema.default('manual'),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

export const assistantRunsOnSchema = z.object({
  provider: providerIdSchema,
  model: z.string().nullable(),
  modelLabel: z.string().nullable(),
  effort: z.string().nullable(),
  fastEffort: z.string().nullable(),
  noFastModel: z.boolean(),
});
export type AssistantRunsOn = z.infer<typeof assistantRunsOnSchema>;

export const assistantSessionSchema = z.object({
  provider: z.string(),
  startedAt: z.string(),
  lastUsedAt: z.string(),
  contextPercent: z.number().int().min(0).max(100).nullable(),
});
export type AssistantSession = z.infer<typeof assistantSessionSchema>;

export const ASSISTANT_FACTS_MAX = 20;
export const ASSISTANT_FACT_MAX_LENGTH = 200;

export const assistantFactSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  createdAt: z.string(),
});
export type AssistantFact = z.infer<typeof assistantFactSchema>;

export const assistantEventKindSchema = z.enum([
  'session_started',
  'session_resumed',
  'session_reseeded',
  'compacted_threshold',
  'compacted_idle',
  'settings_changed',
  'fact_added',
  'fact_removed',
  'history_cleared',
  'topic_started',
]);
export type AssistantEventKind = z.infer<typeof assistantEventKindSchema>;

export const assistantEventSchema = z.object({
  id: z.uuid(),
  runId: z.uuid().nullable(),
  kind: assistantEventKindSchema,
  line: z.string(),
  at: z.string(),
});
export type AssistantEvent = z.infer<typeof assistantEventSchema>;

export const assistantEventsSchema = z.object({ events: z.array(assistantEventSchema) });

export const assistantSettingsViewSchema = z.object({
  settings: assistantSettingsSchema,
  runsOn: assistantRunsOnSchema.nullable(),
  conversationId: z.uuid().nullable(),
  session: assistantSessionSchema.nullable(),
  facts: z.array(assistantFactSchema),
  notice: z.string().nullable(),
  busy: z.boolean(),
});
export type AssistantSettingsView = z.infer<typeof assistantSettingsViewSchema>;

export const clearAssistantRequestSchema = z.object({ facts: z.boolean() });
export type ClearAssistantRequest = z.infer<typeof clearAssistantRequestSchema>;
