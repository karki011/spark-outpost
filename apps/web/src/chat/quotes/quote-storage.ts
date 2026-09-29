import { z } from 'zod';
import { annotationKindSchema, textAnchorSchema } from '@spark-outpost/contracts';
import type { Quote } from './use-quotes.ts';

const storedQuotesSchema = z.array(
  z.object({
    id: z.string().min(1),
    kind: annotationKindSchema,
    text: z.string().min(1),
    note: z.string(),
    messageId: z.string().nullable(),
    anchor: textAnchorSchema.nullable(),
  }),
);

function quotesKey(conversationId: string): string {
  return `spark-outpost.quotes.${conversationId}`;
}

export function loadQuotes(conversationId: string): Quote[] {
  try {
    const raw = localStorage.getItem(quotesKey(conversationId));
    if (!raw) return [];
    const parsed = storedQuotesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveQuotes(conversationId: string, quotes: readonly Quote[]): void {
  try {
    if (quotes.length === 0) localStorage.removeItem(quotesKey(conversationId));
    else localStorage.setItem(quotesKey(conversationId), JSON.stringify(quotes));
  } catch {
    return;
  }
}
