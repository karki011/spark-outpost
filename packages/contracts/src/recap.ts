import { z } from 'zod';
import { totalCostSourceSchema } from './audit.ts';

export const RECAP_SECTIONS = ['done', 'progress', 'help', 'you'] as const;
export const recapSectionSchema = z.enum(RECAP_SECTIONS);
export type RecapSection = z.infer<typeof recapSectionSchema>;

export const RECAP_ITEMS_MAX = 12;
export const RECAP_TEXT_MAX_LENGTH = 240;

export const recapItemSchema = z.object({
  me: z.string().trim().min(1).max(RECAP_TEXT_MAX_LENGTH),
  manager: z.string().trim().min(1).max(RECAP_TEXT_MAX_LENGTH).nullable(),
  url: z.url().nullable(),
  chatId: z.uuid().nullable(),
});
export type RecapItem = z.infer<typeof recapItemSchema>;

const items = z.array(recapItemSchema).max(RECAP_ITEMS_MAX);

export const recapBodySchema = z.object({
  done: items,
  progress: items,
  help: items,
  you: items,
});
export type RecapBody = z.infer<typeof recapBodySchema>;

export const recapTotalsSchema = z.object({
  chats: z.number().int().min(0),
  merged: z.number().int().min(0),
  open: z.number().int().min(0),
  tickets: z.number().int().min(0),
});
export type RecapTotals = z.infer<typeof recapTotalsSchema>;

const replyItem = z.object({
  me: z.string(),
  manager: z.string().nullable().optional(),
  facts: z.array(z.string()).default([]),
});

export const recapReplySchema = z.object({
  done: z.array(replyItem).default([]),
  progress: z.array(replyItem).default([]),
  help: z.array(replyItem).default([]),
  you: z.array(replyItem).default([]),
});
export type RecapReply = z.infer<typeof recapReplySchema>;

export const recapStatusSchema = z.enum(['running', 'ready', 'failed']);
export type RecapStatus = z.infer<typeof recapStatusSchema>;

export const weekRecapSchema = z.object({
  id: z.uuid(),
  status: recapStatusSchema,
  weekStart: z.string(),
  since: z.string(),
  until: z.string(),
  body: recapBodySchema.nullable(),
  totals: recapTotalsSchema,
  error: z.string().nullable(),
  provider: z.string(),
  modelLabel: z.string().nullable(),
  costUsd: z.number().nullable(),
  costSource: totalCostSourceSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type WeekRecap = z.infer<typeof weekRecapSchema>;

export const RECAP_REFINE_INSTRUCTION_MAX_LENGTH = 500;
export const RECAP_REFINE_TEXT_MAX_LENGTH = 4000;

export const recapVoiceSchema = z.enum(['me', 'manager']);
export type RecapVoice = z.infer<typeof recapVoiceSchema>;

export const recapRefineRequestSchema = z.object({
  voice: recapVoiceSchema,
  text: z.string().trim().min(1).max(RECAP_REFINE_TEXT_MAX_LENGTH),
  instruction: z.string().trim().min(1).max(RECAP_REFINE_INSTRUCTION_MAX_LENGTH),
});
export type RecapRefineRequest = z.infer<typeof recapRefineRequestSchema>;

export const recapRefineSchema = z.object({
  id: z.uuid(),
  voice: recapVoiceSchema,
  instruction: z.string(),
  textIn: z.string(),
  textOut: z.string().nullable(),
  status: recapStatusSchema,
  error: z.string().nullable(),
  costUsd: z.number().nullable(),
  createdAt: z.string(),
});
export type RecapRefine = z.infer<typeof recapRefineSchema>;

export const recapStateSchema = z.object({
  available: z.boolean(),
  enabled: z.boolean(),
  due: z.boolean(),
  recap: weekRecapSchema.nullable(),
  refines: z.array(recapRefineSchema),
});
export type RecapState = z.infer<typeof recapStateSchema>;
