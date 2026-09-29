import type { ConversationSummary, Digest } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { compactAge, inboxIdOf } from '../tickets/ticket-model.ts';
import type { NeedItem, NeedTone } from './home-model.ts';

export type FeedSeverity = 'warn' | 'bad' | 'done';

const SEVERITY: Record<NeedTone, FeedSeverity> = { asking: 'warn', error: 'bad', done: 'done' };

export interface FeedRow {
  item: NeedItem;
  severity: FeedSeverity;
  age: string;
  ageTitle: string;
  primary: boolean;
}

export function feedRows(need: readonly NeedItem[], now: number): FeedRow[] {
  return need.map((item) => ({
    item,
    severity: SEVERITY[item.tone],
    age: compactAge(item.chat.updatedAt, now),
    ageTitle: `Updated ${relativeTime(item.chat.updatedAt, now)}`,
    primary: item.tone === 'asking',
  }));
}

export const BRIEF_ENTRIES_MAX = 3;

export type BriefTarget =
  | { kind: 'chat'; chat: ConversationSummary; draft: string | null }
  | { kind: 'ticket'; itemId: string };

export interface BriefEntry {
  id: string;
  key: string | null;
  title: string;
  text: string;
  verb: 'Answer' | 'Continue' | 'Open';
  target: BriefTarget;
}

export function ticketKeyOf(itemId: string): string | null {
  const [source, ...rest] = inboxIdOf(itemId)?.split(':') ?? [];
  const key = rest.join(':');
  return source && key ? key : null;
}

export function ticketEntries(
  digest: Digest | null,
  titleOf: (itemId: string) => string | null,
): BriefEntry[] {
  return (digest?.body?.items ?? []).flatMap((item): BriefEntry[] => {
    const key = ticketKeyOf(item.itemId);
    if (!key) return [];
    const target: BriefTarget = { kind: 'ticket', itemId: item.itemId };
    const title = titleOf(item.itemId) ?? '';
    return [{ id: item.itemId, key, title, text: item.text, verb: 'Open', target }];
  });
}

function chatEntries(digest: Digest | null, chats: readonly ConversationSummary[]): BriefEntry[] {
  return (digest?.body?.suggestions ?? []).flatMap((suggestion): BriefEntry[] => {
    const chat = chats.find((entry) => entry.id === suggestion.chatId && !entry.archivedAt);
    if (!chat) return [];
    const asking = chat.needsInput;
    return [
      {
        id: chat.id,
        key: null,
        title: chat.title,
        text: suggestion.reason,
        verb: asking ? 'Answer' : 'Continue',
        target: { kind: 'chat', chat, draft: asking ? null : suggestion.draft },
      },
    ];
  });
}

export function briefEntries(
  digest: Digest | null,
  chats: readonly ConversationSummary[],
  titleOf: (itemId: string) => string | null,
): BriefEntry[] {
  if (digest?.status !== 'ready') return [];
  const forChats = chatEntries(digest, chats);
  const answers = forChats.filter((entry) => entry.verb === 'Answer');
  const others = forChats.filter((entry) => entry.verb !== 'Answer');
  return [...answers, ...ticketEntries(digest, titleOf), ...others].slice(0, BRIEF_ENTRIES_MAX);
}

export type NeedsMode = 'loading' | 'today' | 'pickup' | 'hidden';

interface NeedsModeInput {
  loading: boolean;
  needCount: number;
  entryCount: number;
  briefOn: boolean;
}

export function needsMode({ loading, needCount, entryCount, briefOn }: NeedsModeInput): NeedsMode {
  if (loading) return 'loading';
  if (needCount > 0) return 'today';
  return briefOn && entryCount > 0 ? 'pickup' : 'hidden';
}

export function writingMeta(flagged: number): string {
  if (flagged === 0) return 'Reading your recent chats…';
  const items = flagged === 1 ? '1 flagged item' : `${flagged} flagged items`;
  return `Reading ${items} and your recent chats…`;
}
