import { useQuery } from '@tanstack/react-query';
import { ticketItemId, type ConversationSummary } from '@spark-outpost/contracts';
import { queueDraft } from '../chat/composer/pending-draft.ts';
import type { Voice } from '../spark/voice.ts';
import { ticketKeys, ticketsApi } from '../tickets/tickets-api.ts';
import { BriefPanel } from './BriefPanel.tsx';
import { HomeCard } from './HomeCards.tsx';
import { canRefresh, refreshHint } from './digest-model.ts';
import { briefEntries, type BriefEntry } from './needs-model.ts';
import type { Brief } from './use-brief.ts';

interface BriefSectionProps {
  brief: Brief;
  chats: readonly ConversationSummary[];
  flagged: number;
  voice: Voice;
  now: number;
  onOpenChat: (chat: ConversationSummary) => void;
  onOpenId: (conversationId: string) => void;
  onTickets: (itemId: string | null) => void;
}

function useTicketTitles() {
  const inbox = useQuery({ queryKey: ticketKeys.inbox, queryFn: ticketsApi.inbox, enabled: false });
  const titles = new Map(
    (inbox.data?.tickets ?? []).map((ticket) => [
      ticketItemId(ticket.source, ticket.key),
      ticket.title,
    ]),
  );
  return (itemId: string) => titles.get(itemId) ?? null;
}

function RefreshButton({ brief, now }: { brief: Brief; now: number }) {
  const ready = brief.enabled && !brief.writing && canRefresh(brief.state, now);
  return (
    <button
      type="button"
      className="hlink"
      disabled={!ready}
      title={brief.writing ? undefined : (refreshHint(brief.state, now) ?? undefined)}
      onClick={brief.refresh}
    >
      {brief.writing ? 'Writing…' : 'Refresh'}
    </button>
  );
}

export function BriefSection({ brief, chats, flagged, voice, now, ...props }: BriefSectionProps) {
  const titleOf = useTicketTitles();
  if (!brief.available) return null;
  const entries = briefEntries(brief.current, chats, titleOf);
  const openEntry = (entry: BriefEntry) => {
    const { target } = entry;
    if (target.kind === 'ticket') return props.onTickets(target.itemId);
    if (!target.draft) return props.onOpenChat(target.chat);
    queueDraft(target.chat.id, target.draft);
    props.onOpenId(target.chat.id);
  };
  const openById = (id: string) => {
    const chat = chats.find((entry) => entry.id === id);
    if (chat) props.onOpenChat(chat);
    else props.onOpenId(id);
  };
  return (
    <HomeCard
      id="home-brief"
      title="Brief"
      className="home-brief"
      action={<RefreshButton brief={brief} now={now} />}
    >
      <BriefPanel
        brief={brief}
        entries={entries}
        flagged={flagged}
        quiet={flagged === 0}
        voice={voice}
        now={now}
        onEntry={openEntry}
        onOpenChat={openById}
      />
    </HomeCard>
  );
}
