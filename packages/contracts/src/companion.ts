import { z } from 'zod';

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
