import { z } from 'zod';

export const attentionItemKindSchema = z.enum([
  'approval',
  'terminal',
  'flag',
  'run-done',
  'run-failed',
  'shell-alert',
  'pr-clean',
]);
export type AttentionItemKind = z.infer<typeof attentionItemKindSchema>;

export const attentionItemSchema = z.object({
  key: z.string().min(1).max(160),
  kind: attentionItemKindSchema,
  blocking: z.boolean(),
  conversationId: z.uuid(),
  detail: z.string().nullable(),
  at: z.string(),
  readAt: z.string().nullable(),
  setAsideAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const attentionListSchema = z.object({ items: z.array(attentionItemSchema) });
export type AttentionList = z.infer<typeof attentionListSchema>;

export const attentionMarkSchema = z.enum(['read', 'set-aside', 'dismiss']);
export type AttentionMark = z.infer<typeof attentionMarkSchema>;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_PATTERN = new RegExp(
  `^(?:(approval|flag|run-done|run-failed|shell-alert):(${UUID})|terminal:(${UUID}):(\\d{1,9}):(\\d{1,15})|pr-clean:(${UUID}):([0-9a-f]{7,64}))$`,
  'i',
);

type IdKeyKind = 'approval' | 'flag' | 'run-done' | 'run-failed' | 'shell-alert';

export type ParsedAttentionKey =
  | { kind: IdKeyKind; id: string }
  | { kind: 'terminal'; id: string; generation: number; since: number }
  | { kind: 'pr-clean'; id: string; head: string };

export function parseAttentionKey(key: string): ParsedAttentionKey | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  if (match[1] && match[2]) {
    return { kind: match[1] as IdKeyKind, id: match[2] };
  }
  if (match[6] && match[7]) {
    return { kind: 'pr-clean', id: match[6], head: match[7].toLowerCase() };
  }
  return {
    kind: 'terminal',
    id: match[3]!,
    generation: Number(match[4]),
    since: Number(match[5]),
  };
}

export function approvalAttentionKey(approvalId: string): string {
  return `approval:${approvalId}`;
}

export function terminalAttentionKey(sessionId: string, generation: number, since: Date): string {
  return `terminal:${sessionId}:${generation}:${since.getTime()}`;
}

export function prCleanAttentionKey(pullId: string, headSha: string): string {
  return `pr-clean:${pullId}:${headSha}`;
}

export function alerting(item: AttentionItem): boolean {
  return item.blocking && !item.readAt && !item.setAsideAt && !item.dismissedAt;
}

export function waitingOnYou(item: AttentionItem): boolean {
  return item.blocking && !item.setAsideAt && !item.dismissedAt;
}

export function asideItem(item: AttentionItem): boolean {
  return item.blocking && item.setAsideAt !== null && !item.dismissedAt;
}

export function freshUpdate(item: AttentionItem): boolean {
  return !item.blocking && !item.readAt && !item.dismissedAt;
}

export function alertingChats(items: readonly AttentionItem[]): Set<string> {
  return new Set(items.filter(alerting).map((item) => item.conversationId));
}
