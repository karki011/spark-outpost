import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_ATTENTION_SETTINGS,
  ticketSourceNames,
  type InboxTicket,
  type TicketSection,
  type TicketSearchResult,
  type TicketSourceId,
} from '@spark-outpost/contracts';
import { EmptyScene } from '../brand/EmptyScene.tsx';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { BriefStrip } from './BriefStrip.tsx';
import { ConnectTickets } from './ConnectTickets.tsx';
import { InboxSections } from './InboxSections.tsx';
import { SearchResults } from './SearchResults.tsx';
import { StartTicketDialog } from './StartTicketDialog.tsx';
import { TicketDetail, type DetailTicket } from './TicketDetail.tsx';
import { TicketFilterBar } from './TicketFilterBar.tsx';
import { Glyph } from './ticket-icons.tsx';
import {
  ALL_FILTERS,
  countBy,
  filterTickets,
  inboxIdOf,
  snoozedTickets,
  ticketId,
  type RowAction,
  type TicketFilters,
  type TicketView,
} from './ticket-model.ts';
import { TicketsHeader } from './TicketsHeader.tsx';
import { TicketsSkeleton } from './TicketsSkeleton.tsx';
import { TicketViews } from './TicketViews.tsx';
import { useAssign } from './use-assign.ts';
import { useDensity } from './use-density.ts';
import { useTicketInbox } from './use-ticket-inbox.ts';
import { useTicketSearch } from './use-ticket-search.ts';
import './tickets.css';
import './ticket-rows.css';
import './ticket-search.css';
import './ticket-detail.css';

interface TicketsProps {
  focusId: string | null;
  onOpenChat: (conversationId: string) => void;
  onHome: () => void;
}

const SOURCE_ORDER: readonly TicketSourceId[] = ['linear', 'jira'];

function sourcesLabel(sources: readonly TicketSourceId[]): string {
  const shown = SOURCE_ORDER.filter((source) => sources.length === 0 || sources.includes(source));
  return shown.map((source) => ticketSourceNames[source]).join(' and ');
}

function moveSelection(event: KeyboardEvent<HTMLElement>) {
  const step = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[event.key];
  if (!step || !(event.target instanceof HTMLElement) || !event.target.matches('.ir-main')) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.ir-main')];
  const next = rows[rows.indexOf(event.target as HTMLButtonElement) + step];
  if (!next) return;
  event.preventDefault();
  next.focus();
  next.click();
}

export function Tickets({ focusId, onOpenChat, onHome }: TicketsProps) {
  const { connections, connected, inbox } = useTicketInbox();
  const [view, setView] = useState<TicketView>('inbox');
  const [filters, setFilters] = useState<TicketFilters>(ALL_FILTERS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<TicketSection>>(new Set(['done']));
  const [selectedId, setSelectedId] = useState(() => (focusId ? inboxIdOf(focusId) : null));
  const [starting, setStarting] = useState<DetailTicket | null>(null);
  const [density, setDensity] = useDensity();
  const searchRef = useRef<HTMLInputElement>(null);
  const toaster = useToast();
  const assigner = useAssign(toaster.show);
  const search = useTicketSearch(filters, connected);
  const now = useMinuteClock();

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const data = inbox.data;
  const { setText: searchFor } = search;
  const focusChecked = useRef(false);
  useEffect(() => {
    if (focusChecked.current || !data || !selectedId) return;
    focusChecked.current = true;
    if (data.tickets.some((ticket) => ticketId(ticket) === selectedId)) return;
    searchFor(selectedId.slice(selectedId.indexOf(':') + 1));
  }, [data, selectedId, searchFor]);
  const settings = data?.settings ?? DEFAULT_ATTENTION_SETTINGS;
  const sources = data?.sources ?? [];
  const label = sourcesLabel(sources);
  const tickets = filterTickets(data?.tickets ?? [], filters);
  const counts = countBy(tickets);

  const findInbox = (id: string) => data?.tickets.find((ticket) => ticketId(ticket) === id) ?? null;
  const findResult = (id: string) =>
    search.results?.tickets.find((ticket) => ticketId(ticket) === id) ?? null;
  const detail = ((): DetailTicket | null => {
    if (!selectedId) return null;
    const mine = findInbox(selectedId);
    const found = search.active ? findResult(selectedId) : null;
    if (found) return { ...found, inbox: mine };
    return mine ? { ...mine, mine: true, inbox: mine } : null;
  })();

  const act = (ticket: InboxTicket, action: RowAction) => {
    if ((action.kind === 'answer' || action.kind === 'open-chat') && ticket.chat) {
      onOpenChat(ticket.chat.conversationId);
    } else if (action.kind === 'open-pr' && action.url) {
      window.open(action.url, '_blank', 'noopener,noreferrer');
    } else {
      setStarting({ ...ticket, mine: true, inbox: ticket });
    }
  };

  const toggleSection = (section: TicketSection) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const selectResult = (ticket: TicketSearchResult) => setSelectedId(ticketId(ticket));
  const loading = connections.isPending || (connected && inbox.isPending);
  const authProblems = (data?.errors ?? []).filter((problem) => problem.kind === 'auth');

  return (
    <main
      className={density === 'compact' ? 'page tk compact' : 'page tk'}
      aria-labelledby="tk-title"
    >
      <TicketsHeader
        searchRef={searchRef}
        text={search.text}
        onText={search.setText}
        onClear={search.clear}
        sourcesLabel={label}
        connected={connected}
        syncedAt={data?.syncedAt ?? null}
        failed={(data?.errors ?? []).map((problem) => problem.source)}
        refreshing={inbox.isFetching}
        onRefresh={() => void inbox.refetch()}
      />
      {connections.isSuccess && !connected ? (
        <ConnectTickets />
      ) : (
        <>
          <TicketFilterBar
            sources={sources}
            projects={data?.tickets ?? []}
            filters={filters}
            onFilters={setFilters}
            searching={search.active}
            assignee={search.assignee}
            onAssignee={search.setAssignee}
            density={density}
            onDensity={setDensity}
          />
          {authProblems.map((problem) => (
            <div key={problem.source} className="tk-alert" role="alert">
              <Glyph name="warn" size={16} />
              <span>
                <b>{ticketSourceNames[problem.source]} rejected the saved token.</b>{' '}
                {problem.message}
              </span>
            </div>
          ))}
          {loading ? (
            <TicketsSkeleton sourcesLabel={label} />
          ) : (
            <div className="ib">
              <TicketViews
                view={view}
                total={tickets.length}
                counts={counts}
                snoozed={snoozedTickets(tickets).length}
                settings={settings}
                onView={(next) => {
                  setView(next);
                  search.clear();
                }}
              />
              <div className="ib-main" onKeyDown={moveSelection}>
                {search.active ? (
                  <SearchResults
                    query={search.text.trim()}
                    results={search.results}
                    loading={search.loading}
                    sourcesLabel={label}
                    selectedId={selectedId}
                    assigner={assigner}
                    onSelect={selectResult}
                    onClear={search.clear}
                  />
                ) : tickets.length === 0 ? (
                  <EmptyScene fill>
                    <b>Nothing is assigned to you in {label} right now.</b>
                    Search above to find a ticket and assign it to yourself.
                  </EmptyScene>
                ) : (
                  <>
                    {view === 'inbox' && density === 'comfortable' && (
                      <BriefStrip
                        tickets={tickets}
                        now={now}
                        onSelect={(ticket) => setSelectedId(ticketId(ticket))}
                        onAction={act}
                        onHome={onHome}
                      />
                    )}
                    <InboxSections
                      tickets={tickets}
                      view={view}
                      collapsed={collapsed}
                      selectedId={selectedId}
                      onToggle={toggleSection}
                      onSelect={(ticket) => setSelectedId(ticketId(ticket))}
                      onAction={act}
                    />
                  </>
                )}
              </div>
              {detail && (
                <TicketDetail
                  key={ticketId(detail)}
                  ticket={detail}
                  assigning={assigner.state.pending === ticketId(detail)}
                  confirming={assigner.isConfirming(detail, 'detail')}
                  assignError={assigner.state.errors[ticketId(detail)] ?? null}
                  onConfirm={() => void assigner.confirm(detail)}
                  onCancelConfirm={assigner.cancel}
                  onClose={() => setSelectedId(null)}
                  onAssign={() => assigner.request(detail, detail.mine, 'detail')}
                  onStart={() => setStarting(detail)}
                  onOpenChat={onOpenChat}
                />
              )}
            </div>
          )}
        </>
      )}
      {starting && (
        <StartTicketDialog
          ticket={starting}
          onClose={() => setStarting(null)}
          onStarted={(conversationId) => {
            setStarting(null);
            onOpenChat(conversationId);
          }}
        />
      )}
      <div className="tk-toasts">
        <ToastHost toaster={toaster} />
      </div>
    </main>
  );
}
