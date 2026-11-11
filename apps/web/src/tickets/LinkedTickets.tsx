import {
  ticketSourceNames,
  type TicketDetail,
  type TicketSourceId,
  type TicketSubtask,
} from '@spark-outpost/contracts';
import { StatusBadge } from './StatusChip.tsx';
import { safeUrl, ticketId } from './ticket-model.ts';

export interface LinkedGroup {
  label: string;
  rows: TicketSubtask[];
}

export function linkedGroups(ticket: TicketDetail): LinkedGroup[] {
  const groups: LinkedGroup[] = [];
  if (ticket.parent) groups.push({ label: 'Parent', rows: [ticket.parent] });
  if (ticket.subtasks.length > 0) {
    groups.push({
      label: 'Subtasks',
      rows: ticket.subtasks,
    });
  }
  const byRelation = new Map<string, TicketSubtask[]>();
  for (const link of ticket.relations ?? []) {
    byRelation.set(link.relation, [...(byRelation.get(link.relation) ?? []), link]);
  }
  for (const [relation, rows] of byRelation) {
    groups.push({ label: relation.charAt(0).toUpperCase() + relation.slice(1), rows });
  }
  return groups;
}

interface LinkedTicketsProps {
  ticket: TicketDetail;
  loaded: ReadonlySet<string>;
  onOpen: (source: TicketSourceId, key: string) => void;
}

export function LinkedTickets({ ticket, loaded, onOpen }: LinkedTicketsProps) {
  const groups = linkedGroups(ticket);
  if (groups.length === 0) return null;
  return (
    <section className="tk-sec" aria-label="Linked">
      <h4>Linked</h4>
      {groups.map((group) => (
        <div key={group.label} className="tk-linked-group">
          <h5>{group.label}</h5>
          {group.rows.map((row) => (
            <LinkedRow
              key={row.key}
              row={row}
              source={ticket.source}
              loaded={loaded.has(ticketId({ source: ticket.source, key: row.key }))}
              onOpen={onOpen}
            />
          ))}
          {group.label === 'Subtasks' && ticket.subtasksMore && (
            <p className="tk-quiet">There are more subtasks than listed here.</p>
          )}
        </div>
      ))}
    </section>
  );
}

function LinkedRow({
  row,
  source,
  loaded,
  onOpen,
}: {
  row: TicketSubtask;
  source: TicketSourceId;
  loaded: boolean;
  onOpen: LinkedTicketsProps['onOpen'];
}) {
  const content = (
    <>
      <span className="tk-key">{row.key}</span>
      <span className="t">{row.title}</span>
      <StatusBadge status={row.status} name={row.statusName} />
    </>
  );
  if (loaded) {
    return (
      <button type="button" className="subt tk-linked-row" onClick={() => onOpen(source, row.key)}>
        {content}
      </button>
    );
  }
  const href = safeUrl(row.url);
  if (!href) return <div className="subt">{content}</div>;
  return (
    <a
      className="subt tk-linked-row"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${row.key} ${row.title}, opens in ${ticketSourceNames[source]}`}
    >
      {content}
    </a>
  );
}
