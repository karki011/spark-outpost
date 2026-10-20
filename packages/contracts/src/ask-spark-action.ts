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
