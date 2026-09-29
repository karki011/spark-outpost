import { EmptyScene } from '../brand/EmptyScene.tsx';
import {
  ticketSourceNames,
  ticketStatusLabels,
  type TicketSearch,
  type TicketSearchResult,
} from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { AssignConfirm } from './AssignConfirm.tsx';
import { SectionHeader } from './SectionHeader.tsx';
import { Glyph } from './ticket-icons.tsx';
import { compactAge, SEARCH_GROUPS, searchGroup, ticketId, whose } from './ticket-model.ts';
import { TicketRow } from './TicketRow.tsx';
import { SkeletonRows } from './TicketsSkeleton.tsx';
import type { Assigner } from './use-assign.ts';

interface SearchResultsProps {
  query: string;
  results: TicketSearch | undefined;
  loading: boolean;
  sourcesLabel: string;
  selectedId: string | null;
  assigner: Assigner;
  onSelect: (ticket: TicketSearchResult) => void;
  onClear: () => void;
}

const GROUP_RULES = {
  mine: 'Tickets already assigned to you.',
  unassigned: 'Nobody owns these yet. Assign to me takes one in a single step.',
  others: 'Someone else owns these. Spark asks before it takes one from them.',
};

function SearchRow({
  ticket,
  selected,
  assigner,
  onSelect,
}: {
  ticket: TicketSearchResult;
  selected: boolean;
  assigner: Assigner;
  onSelect: () => void;
}) {
  const id = ticketId(ticket);
  const { state } = assigner;
  const source = ticketSourceNames[ticket.source];
  const pinned =
    state.pending === id ? (
      <span className="pend-line">
        <i className="pdot" aria-hidden="true" />
        Assigning in {source}
      </span>
    ) : state.assigned[id] ? (
      <span className="pend-line done">Assigned to you</span>
    ) : undefined;
  const error = state.errors[id];
  return (
    <TicketRow
      id={id}
      source={ticket.source}
      ticketKey={ticket.key}
      title={ticket.title}
      priorityRank={ticket.priorityRank}
      status={{ status: ticket.status, label: ticketStatusLabels[ticket.status] }}
      reason={whose(ticket)}
      tone="none"
      more={[]}
      age={{
        text: compactAge(ticket.updatedAt),
        title: `Updated ${relativeTime(ticket.updatedAt)}`,
      }}
      selected={selected}
      onSelect={onSelect}
      pinned={pinned}
      action={
        ticket.mine
          ? null
          : {
              label: 'Assign to me',
              name: `Assign ${ticket.key} to me`,
              primary: true,
              onClick: () => assigner.request(ticket, ticket.mine, 'row'),
            }
      }
      below={
        <>
          {assigner.isConfirming(ticket, 'row') && (
            <AssignConfirm
              ticket={ticket}
              onCancel={assigner.cancel}
              onConfirm={() => void assigner.confirm(ticket)}
            />
          )}
          {error && (
            <div className="inline-err" role="alert">
              <Glyph name="warn" size={14} />
              <span>{error}</span>
            </div>
          )}
        </>
      }
    />
  );
}

export function SearchResults(props: SearchResultsProps) {
  const { results } = props;
  if (props.loading || !results) {
    return (
      <div aria-busy="true">
        <p className="sr-only" role="status">
          Searching {props.sourcesLabel}
        </p>
        <SkeletonRows count={5} />
      </div>
    );
  }
  const count = results.tickets.length;
  return (
    <>
      <p className="res-h" role="status">
        <b>
          {count} {count === 1 ? 'result' : 'results'}
        </b>
        for &ldquo;{props.query}&rdquo; across all tickets in {props.sourcesLabel}
      </p>
      {results.errors.map((problem) => (
        <p key={problem.source} className="src-note">
          <Glyph name="warn" size={14} />
          {problem.message}
        </p>
      ))}
      {count === 0 && (
        <EmptyScene>
          <p>
            Nothing in {props.sourcesLabel} matches &ldquo;{props.query}&rdquo;.
          </p>
          <button type="button" className="btn line sm" onClick={props.onClear}>
            Clear search
          </button>
        </EmptyScene>
      )}
      {SEARCH_GROUPS.map((group) => {
        const rows = results.tickets.filter((ticket) => searchGroup(ticket) === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-label={group.label}>
            <SectionHeader
              id={`tk-res-${group.id}`}
              label={group.label}
              count={rows.length}
              rule={GROUP_RULES[group.id]}
            />
            <ul id={`tk-res-${group.id}`} className="tk-rows">
              {rows.map((ticket) => (
                <SearchRow
                  key={ticketId(ticket)}
                  ticket={ticket}
                  selected={props.selectedId === ticketId(ticket)}
                  assigner={props.assigner}
                  onSelect={() => props.onSelect(ticket)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
