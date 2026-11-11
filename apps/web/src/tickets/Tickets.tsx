import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  filterTickets,
  inboxIdOf,
  ticketId,
  type RowAction,
  type TicketFilters,
  type TicketView,
} from './ticket-model.ts';
import { viewItems } from './ticket-views.ts';
import { TicketsHeader } from './TicketsHeader.tsx';
import { TicketsSkeleton } from './TicketsSkeleton.tsx';
import { TicketViews } from './TicketViews.tsx';
import { useAssign } from './use-assign.ts';
import { useDensity } from './use-density.ts';
import { useDetailWidth } from './use-detail-width.ts';
import { useLiveTickets } from './use-live-tickets.ts';
import { useNoticeSeen } from './use-notice-seen.ts';
import { useTicketInbox } from './use-ticket-inbox.ts';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { useTicketSearch } from './use-ticket-search.ts';
import { useTicketView } from './use-ticket-view.ts';
import './tickets.css';
import './ticket-flow.css';
import './ticket-views.css';
import './ticket-rows.css';
import './ticket-search.css';
import './ticket-detail.css';

interface TicketsProps {
  focusId: string | null;
  onOpenChat: (conversationId: string) => void;
  onHome: () => void;
}

const SOURCE_ORDER: readonly TicketSourceId[] = ['linear', 'jira', 'servicenow'];

function sourcesLabel(sources: readonly TicketSourceId[]): string {
  const shown = SOURCE_ORDER.filter((source) => sources.length === 0 || sources.includes(source));
  const names = shown.map((source) => ticketSourceNames[source]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('');
}

const ROW_STEPS: Record<string, number> = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 };

function moveSelection(event: KeyboardEvent<HTMLElement>, follow: boolean) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.matches('.ir-main')) return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.ir-main')];
  const at = rows.indexOf(target);
  const next =
    event.key === 'Home'
      ? rows[0]
      : event.key === 'End'
        ? rows.at(-1)
        : ROW_STEPS[event.key]
          ? rows[at + ROW_STEPS[event.key]!]
          : undefined;
  if (!next) return;
  event.preventDefault();
  next.focus();
  if (follow) next.click();
}

export function Tickets({ focusId, onOpenChat, onHome }: TicketsProps) {
  const { connections, connected, inbox, refresh } = useTicketInbox();
  const [view, setView] = useTicketView();
  const [filters, setFilters] = useState<TicketFilters>(ALL_FILTERS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<TicketSection>>(new Set(['done']));
  const [selectedId, setSelectedId] = useState(() => (focusId ? inboxIdOf(focusId) : null));
  const [starting, setStarting] = useState<DetailTicket | null>(null);
  const [density, setDensity] = useDensity();
  const [detailWidth, setDetailWidth] = useDetailWidth();
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
  const focusChecked = useRef(selectedId === null);
  useEffect(() => {
    if (focusChecked.current || !data || !selectedId) return;
    focusChecked.current = true;
    if (data.tickets.some((ticket) => ticketId(ticket) === selectedId)) return;
    searchFor(selectedId.slice(selectedId.indexOf(':') + 1));
  }, [data, selectedId, searchFor]);
  const settings = data?.settings ?? DEFAULT_ATTENTION_SETTINGS;
  const sources = data?.sources ?? [];
  const label = sourcesLabel(sources);
  const tickets = useMemo(() => filterTickets(data?.tickets ?? [], filters), [data, filters]);
  const entries = useLiveTickets(tickets);
  const currentView = search.active ? null : view;
  const showView = (next: TicketView) => {
    setView(next);
    search.clear();
  };

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

  const markSeen = useNoticeSeen();
  const opened = detail?.inbox ?? null;
  useEffect(() => {
    if (opened) markSeen(opened);
  }, [opened, markSeen]);

  const act = useStableCallback((ticket: InboxTicket, action: RowAction) => {
    if ((action.kind === 'answer' || action.kind === 'open-chat') && ticket.chat) {
      onOpenChat(ticket.chat.conversationId);
    } else if (action.kind === 'open-pr' && action.url) {
      markSeen(ticket);
      window.open(action.url, '_blank', 'noopener,noreferrer');
    } else {
      setStarting({ ...ticket, mine: true, inbox: ticket });
    }
  });

  const toggleSection = useStableCallback((section: TicketSection) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    }),
  );
  const selectTicket = useStableCallback((ticket: InboxTicket) => setSelectedId(ticketId(ticket)));

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
        onRefresh={() => void refresh()}
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
          {(data?.truncated ?? []).map((id) => (
            <div key={id} className="tk-alert" role="status">
              <Glyph name="warn" size={16} />
              <span>
                <b>{ticketSourceNames[id]} has more tickets than Spark lists.</b> Showing the 500
                most recently updated.
              </span>
            </div>
          ))}
          {loading ? (
            <TicketsSkeleton sourcesLabel={label} />
          ) : (
            <div className="ib">
              <TicketViews
                items={viewItems(entries, currentView)}
                current={currentView}
                settings={settings}
                onView={showView}
              />
              <div className="ib-main" onKeyDown={(event) => moveSelection(event, detail !== null)}>
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
                        onSelect={selectTicket}
                        onAction={act}
                        onHome={onHome}
                      />
                    )}
                    <InboxSections
                      entries={entries}
                      view={view}
                      settings={settings}
                      now={now}
                      collapsed={collapsed}
                      selectedId={selectedId}
                      onToggle={toggleSection}
                      onSelect={selectTicket}
                      onAction={act}
                    />
                  </>
                )}
              </div>
              {detail ? (
                <TicketDetail
                  key={ticketId(detail)}
                  ticket={detail}
                  assigning={assigner.state.pending === ticketId(detail)}
                  confirming={assigner.isConfirming(detail, 'detail')}
                  assignError={assigner.state.errors[ticketId(detail)] ?? null}
                  now={now}
                  width={detailWidth}
                  onWidth={setDetailWidth}
                  onConfirm={() => void assigner.confirm(detail)}
                  onCancelConfirm={assigner.cancel}
                  onClose={() => setSelectedId(null)}
                  onAssign={() => assigner.request(detail, detail.mine, 'detail')}
                  onStart={() => setStarting(detail)}
                  onOpenChat={onOpenChat}
                  onToast={toaster.show}
                />
              ) : (
                <div className="tk-detail tk-none">
                  <p>
                    Select a ticket to see its details
                    <br />
                    and start work from it.
                  </p>
                </div>
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
