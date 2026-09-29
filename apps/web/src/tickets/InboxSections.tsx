import type { InboxTicket, TicketSection } from '@spark-outpost/contracts';
import { SectionHeader } from './SectionHeader.tsx';
import {
  ageTitle,
  compactAge,
  rowAction,
  SECTIONS,
  ticketId,
  type RowAction,
  type TicketView,
} from './ticket-model.ts';
import { TicketRow } from './TicketRow.tsx';

interface InboxSectionsProps {
  tickets: readonly InboxTicket[];
  view: TicketView;
  collapsed: ReadonlySet<TicketSection>;
  selectedId: string | null;
  onToggle: (section: TicketSection) => void;
  onSelect: (ticket: InboxTicket) => void;
  onAction: (ticket: InboxTicket, action: RowAction) => void;
}

function syncProblem(ticket: InboxTicket): string | null {
  const sync = ticket.lastSync;
  if (sync?.outcome !== 'failed' || ticket.flags[0]?.rule === 'sync-failed') return null;
  return `${sync.message ?? 'The last change failed.'} Details and Retry are in the ticket.`;
}

function InboxRow({
  ticket,
  selected,
  onSelect,
  onAction,
}: {
  ticket: InboxTicket;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: RowAction) => void;
}) {
  const action = rowAction(ticket);
  return (
    <TicketRow
      id={ticketId(ticket)}
      source={ticket.source}
      ticketKey={ticket.key}
      title={ticket.title}
      priorityRank={ticket.priorityRank}
      reason={ticket.reason}
      tone={ticket.tone}
      more={ticket.flags.slice(1).map((flag) => flag.text)}
      age={ticket.age ? { text: compactAge(ticket.age.at), title: ageTitle(ticket.age) } : null}
      syncProblem={syncProblem(ticket)}
      selected={selected}
      onSelect={onSelect}
      action={
        action
          ? {
              label: action.label,
              name: `${action.label} ${ticket.key}`,
              primary: action.kind === 'answer' || action.kind === 'start',
              onClick: () => onAction(action),
            }
          : null
      }
    />
  );
}

export function InboxSections(props: InboxSectionsProps) {
  const { tickets, view } = props;
  const sections = SECTIONS.filter((section) => view === 'inbox' || section.id === view);
  return (
    <>
      {sections.map((section) => {
        const rows = tickets.filter((ticket) => ticket.section === section.id);
        if (view === 'inbox' && rows.length === 0) return null;
        const listId = `tk-sec-${section.id}`;
        const open = view !== 'inbox' || !props.collapsed.has(section.id);
        return (
          <section key={section.id} aria-label={section.label}>
            <SectionHeader
              id={listId}
              label={section.label}
              count={rows.length}
              rule={section.rule}
              attention={section.id === 'attention'}
              expanded={open}
              onToggle={view === 'inbox' ? () => props.onToggle(section.id) : undefined}
            />
            {open && rows.length === 0 && <p className="sec-empty">Nothing here right now.</p>}
            {open && rows.length > 0 && (
              <ul id={listId} className="tk-rows">
                {rows.map((ticket) => (
                  <InboxRow
                    key={ticketId(ticket)}
                    ticket={ticket}
                    selected={props.selectedId === ticketId(ticket)}
                    onSelect={() => props.onSelect(ticket)}
                    onAction={(action) => props.onAction(ticket, action)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
