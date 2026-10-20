import { z } from 'zod';
import { ticketSourceIdSchema } from './tickets.ts';

export const ASK_SPARK_TEXT_MAX = 4_000;
export const ASK_SPARK_SUMMARY_MAX = 300;

export const askSparkOpSchema = z.enum([
  'start_chat',
  'send_message',
  'stop_turn',
  'archive_chat',
  'answer_card',
  'pause_spark',
  'resume_spark',
  'start_ticket',
  'post_outpost',
  'clear_finished',
  'set_aside',
  'snooze_meeting',
  'dismiss_meeting',
  'join_meeting',
]);
export type AskSparkOp = z.infer<typeof askSparkOpSchema>;

export const askSparkAnswerSchema = z.enum(['allow_once', 'deny']);
export type AskSparkAnswer = z.infer<typeof askSparkAnswerSchema>;

export const askSparkActionSchema = z.object({
  action: z.literal('ask_spark'),
  op: askSparkOpSchema,
  summary: z.string().min(1).max(ASK_SPARK_SUMMARY_MAX),
  conversationId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  approvalId: z.uuid().nullable(),
  answer: askSparkAnswerSchema.nullable(),
  ticket: z.object({ source: ticketSourceIdSchema, key: z.string().max(100) }).nullable(),
  text: z.string().max(ASK_SPARK_TEXT_MAX).nullable(),
  outpostId: z.uuid().nullable().default(null),
  meeting: z
    .object({ eventKey: z.string().max(600), end: z.iso.datetime({ offset: true }) })
    .nullable()
    .default(null),
});
export type AskSparkAction = z.infer<typeof askSparkActionSchema>;

export const askSparkLabels = {
  ask_spark: {
    question: 'Ask Spark wants to:',
    confirm: 'Do it',
    doing: 'Doing it…',
  },
};

export const assistantActsSchema = z.enum(['manual', 'act']);
export type AssistantActs = z.infer<typeof assistantActsSchema>;

export const ISLAND_REQUEST_KINDS = ['snooze_meeting', 'join_meeting', 'set_aside'] as const;
export const islandRequestKindSchema = z.enum(ISLAND_REQUEST_KINDS);
export type IslandRequestKind = z.infer<typeof islandRequestKindSchema>;

export const islandRequestSchema = z.object({
  id: z.uuid(),
  kind: islandRequestKindSchema,
  target: z.string().max(600),
});
export type IslandRequest = z.infer<typeof islandRequestSchema>;

export const islandRequestsSchema = z.object({ requests: z.array(islandRequestSchema).max(50) });
export type IslandRequests = z.infer<typeof islandRequestsSchema>;
