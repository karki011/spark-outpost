import type { AttentionSettings, InboxTicket, TicketSection } from '@spark-outpost/contracts';
import { EmptyScene } from '../brand/EmptyScene.tsx';
import { UserBlob } from '../brand/UserBlob.tsx';
import { rowPreview } from './row-preview.ts';
import { SectionHeader } from './SectionHeader.tsx';
import { StatusChip } from './StatusChip.tsx';
import type { LiveTicket } from './ticket-flow.ts';
import {
  ageTitle,
  attentionRule,
  compactAge,
  rowAction,
  SECTIONS,
  SNOOZED_RULE,
  snoozeTime,
  ticketId,
  type RowAction,
  type TicketView,
} from './ticket-model.ts';
import { RowLinks } from './RowLinks.tsx';
import { TicketRow } from './TicketRow.tsx';

interface InboxSectionsProps {
  entries: readonly LiveTicket[];
  view: TicketView;
  settings: AttentionSettings;
  now: number;
  collapsed: ReadonlySet<TicketSection>;
  selectedId: string | null;
  onToggle: (section: TicketSection) => void;
  onSelect: (ticket: InboxTicket) => void;
  onAction: (ticket: InboxTicket, action: RowAction) => void;
}

const EMPTY_TEXT: Record<TicketView, string> = {
  inbox: 'Nothing assigned to you right now.',
  attention: 'Nothing needs you right now.',
  spark: 'No chat is working on a ticket right now.',
  started: 'Nothing started without a running chat.',
  review: 'Nothing in review and no pull request open.',
  up_next: 'Nothing queued up next.',
  done: 'Nothing finished in the last 7 days.',
  snoozed: 'Nothing snoozed.',
};

function syncProblem(ticket: InboxTicket): string | null {
  const sync = ticket.lastSync;
  if (sync?.outcome !== 'failed' || ticket.flags[0]?.rule === 'sync-failed') return null;
  return `${sync.message ?? 'The last change failed.'} Details and Retry are in the ticket.`;
}

function Assignee({ name }: { name: string }) {
  return (
    <span className="ir-who" role="img" aria-label={`Assigned to ${name}`} title={name}>
      <UserBlob displayName={name} size={18} />
    </span>
  );
}

function InboxRow({
  entry,
  now,
  selected,
  onSelect,
  onAction,
}: {
  entry: LiveTicket;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: RowAction) => void;
}) {
  const { ticket } = entry;
  const action = rowAction({ ...ticket, section: entry.section });
  return (
    <TicketRow
      id={ticketId(ticket)}
      source={ticket.source}
      ticketKey={ticket.key}
      title={ticket.title}
      priorityRank={ticket.priorityRank}
      reason={entry.line}
      tone="none"
      more={entry.section === 'attention' ? ticket.flags.slice(1).map((flag) => flag.text) : []}
      age={
        ticket.age
          ? { text: compactAge(ticket.age.at, now), title: ageTitle(ticket.age, now) }
          : null
      }
      syncProblem={syncProblem(ticket)}
      snoozedUntil={ticket.snooze ? snoozeTime(new Date(ticket.snooze.until), new Date(now)) : null}
      selected={selected}
      onSelect={onSelect}
      chip={<StatusChip section={entry.section} tone={entry.tone} chat={entry.chat} />}
      avatar={ticket.assignedTo ? <Assignee name={ticket.assignedTo.name} /> : null}
      preview={rowPreview(entry, now)}
      links={
        <RowLinks
          ticket={ticket}
          onOpenChat={() => onAction({ kind: 'open-chat', label: 'Open chat' })}
          onOpenPr={(url) => onAction({ kind: 'open-pr', label: 'Open PR', url })}
        />
      }
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

const snoozedEntries = (entries: readonly LiveTicket[]) =>
  entries
    .filter((entry) => entry.ticket.snooze)
    .toSorted((a, b) => (a.ticket.snooze?.until ?? '').localeCompare(b.ticket.snooze?.until ?? ''));

export function InboxSections(props: InboxSectionsProps) {
  const { entries, view } = props;
  const sections =
    view === 'snoozed'
      ? [{ id: 'snoozed' as const, label: 'Snoozed', rule: SNOOZED_RULE }]
      : SECTIONS.filter((section) => view === 'inbox' || section.id === view);
  const ruleOf = (section: (typeof sections)[number]) =>
    section.id === 'attention' ? attentionRule(props.settings) : section.rule;
  return (
    <>
      {sections.map((section) => {
        const rows =
          section.id === 'snoozed'
            ? snoozedEntries(entries)
            : entries.filter((entry) => entry.section === section.id);
        if (view === 'inbox' && rows.length === 0) return null;
        const listId = `tk-sec-${section.id}`;
        const open =
          view !== 'inbox' || section.id === 'snoozed' || !props.collapsed.has(section.id);
        return (
          <section key={section.id} aria-label={section.label}>
            <SectionHeader
              id={listId}
              label={section.label}
              count={rows.length}
              rule={ruleOf(section)}
              attention={section.id === 'attention'}
              expanded={open}
              onToggle={
                view === 'inbox' && section.id !== 'snoozed'
                  ? () => props.onToggle(section.id)
                  : undefined
              }
            />
            {open && rows.length === 0 && <EmptyScene fill>{EMPTY_TEXT[view]}</EmptyScene>}
            {open && rows.length > 0 && (
              <ul id={listId} className="tk-rows">
                {rows.map((entry) => (
                  <InboxRow
                    key={ticketId(entry.ticket)}
                    entry={entry}
                    now={props.now}
                    selected={props.selectedId === ticketId(entry.ticket)}
                    onSelect={() => props.onSelect(entry.ticket)}
                    onAction={(action) => props.onAction(entry.ticket, action)}
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
