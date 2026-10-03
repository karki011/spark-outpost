import './brief-strip.css';
import { ticketItemId, type InboxTicket } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { canRefresh, digestMeta, refreshHint } from '../home/digest-model.ts';
import { BRIEF_ENTRIES_MAX, ticketEntries } from '../home/needs-model.ts';
import { useBrief } from '../home/use-brief.ts';
import { rowAction, type RowAction } from './ticket-model.ts';

interface BriefStripProps {
  tickets: readonly InboxTicket[];
  now: number;
  onSelect: (ticket: InboxTicket) => void;
  onAction: (ticket: InboxTicket, action: RowAction) => void;
  onHome: () => void;
}

const SEVERITY = { none: 'sev', warn: 'sev warn', error: 'sev bad', running: 'sev run' } as const;

function StripSkeleton({ status }: { status: string }) {
  return (
    <section className="brief" aria-labelledby="tk-brief-t" aria-busy="true">
      <div className="brief-h">
        <BlobScout size={22} mood="working" />
        <h3 id="tk-brief-t">What needs you today</h3>
        <span className="brief-meta" role="status">
          {status}
        </span>
      </div>
      <div className="brief-sk" aria-hidden="true">
        <span className="sk" style={{ width: '82%' }} />
        <span className="sk" style={{ width: '64%' }} />
        <span className="sk" style={{ width: '73%' }} />
      </div>
    </section>
  );
}

function BriefLine(props: { ticket: InboxTicket; text: string; index: number } & BriefStripProps) {
  const { ticket, text, index } = props;
  const action = rowAction(ticket);
  return (
    <li className="bi">
      <span className="num" aria-hidden="true">
        {index + 1}
      </span>
      <div>
        <p>
          <button
            type="button"
            className="kref"
            aria-label={`Show ${ticket.key}`}
            onClick={() => props.onSelect(ticket)}
          >
            {ticket.key}
          </button>{' '}
          {text}
        </p>
        <span className="why-r">
          <i className={SEVERITY[ticket.tone]} aria-hidden="true" />
          <span className="txt">{ticket.reason}</span>
        </span>
      </div>
      {action && (
        <button
          type="button"
          className={action.kind === 'answer' || action.kind === 'start' ? 'qa primary' : 'qa'}
          aria-label={`${action.label} ${ticket.key}`}
          onClick={() => props.onAction(ticket, action)}
        >
          {action.label}
        </button>
      )}
    </li>
  );
}

export function BriefStrip(props: BriefStripProps) {
  const { tickets, now } = props;
  const brief = useBrief({ writeOnOpen: false });
  if (!brief.available) return null;
  if (brief.view === 'loading') return <StripSkeleton status="Loading the brief" />;
  if (!brief.enabled) {
    return (
      <section className="brief off" aria-labelledby="tk-brief-t">
        <div className="brief-h">
          <BlobScout size={22} mood="sleep" />
          <h3 id="tk-brief-t">Brief is off</h3>
        </div>
        <div className="brief-foot">
          The rules still flag tickets under Needs you. Turn the brief on for a short summary, about
          $0.01 each.
          <button type="button" className="btn sm line" onClick={() => void brief.turnOn()}>
            Turn on
          </button>
        </div>
      </section>
    );
  }
  if (brief.writing) return <StripSkeleton status="Writing a new brief…" />;
  const current = brief.current;
  const byItem = new Map(
    tickets.map((ticket) => [ticketItemId(ticket.source, ticket.key), ticket]),
  );
  const lines = ticketEntries(current, () => null)
    .flatMap((entry) => {
      const ticket = byItem.get(entry.id);
      return ticket && ticket.section === 'attention' ? [{ ticket, text: entry.text }] : [];
    })
    .slice(0, BRIEF_ENTRIES_MAX);
  if (brief.view !== 'ready' || !current || lines.length === 0) return null;
  const flagged = tickets.filter((ticket) => ticket.section === 'attention').length;
  const more = flagged - lines.length;
  const ready = canRefresh(brief.state, now);
  return (
    <section className="brief" aria-labelledby="tk-brief-t">
      <div className="brief-h">
        <BlobScout size={22} />
        <h3 id="tk-brief-t">What needs you today</h3>
        <span className="brief-meta">{digestMeta(current)}</span>
        <span className="sp" />
        <button
          type="button"
          className="hlink"
          disabled={!ready}
          title={refreshHint(brief.state, now) ?? undefined}
          onClick={brief.refresh}
        >
          Refresh
        </button>
      </div>
      <ol>
        {lines.map((line, index) => (
          <BriefLine key={line.ticket.key} {...props} {...line} index={index} />
        ))}
      </ol>
      <div className="brief-foot">
        <span>
          The ticket items from your Home brief. The flags come from rules, not the AI.
          {more > 0 && ` ${more} more flagged below.`}
        </span>
        <button type="button" className="hlink" onClick={props.onHome}>
          Full brief on Home
        </button>
      </div>
    </section>
  );
}
