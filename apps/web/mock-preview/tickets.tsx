import { useRef, useState } from 'react';
import { TicketsHeader } from '../src/tickets/TicketsHeader.tsx';
import { Glyph } from '../src/tickets/ticket-icons.tsx';
import '../src/tickets/tickets.css';
import '../src/tickets/ticket-search.css';

const tickets = [
  {
    key: 'CP-49259',
    title: 'Order Insights: Sessions and AI Activity in My Work',
    status: 'In review',
    pr: '#353',
  },
  {
    key: 'CP-50096',
    title: 'Remove Dimension Workload from roles view',
    status: 'In review',
    pr: '#512',
  },
  { key: 'CP-50285', title: 'Denser layout for CZNext', status: 'In review', pr: '#69' },
  {
    key: 'CP-49859',
    title: 'Estimated tags on built-in reports',
    status: 'In progress',
    pr: '#2453',
  },
];

export function TicketPreview({
  syncing,
  failed,
  onSync,
  onFinish,
  onChat,
}: {
  syncing: boolean;
  failed: boolean;
  onSync: () => void;
  onFinish: (failed: boolean) => void;
  onChat: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(tickets[0]);
  const [filter, setFilter] = useState('In review');
  const searchRef = useRef<HTMLInputElement>(null);
  const visible = tickets.filter(
    (ticket) =>
      (!search || `${ticket.key} ${ticket.title}`.toLowerCase().includes(search.toLowerCase())) &&
      (filter === 'Inbox' || ticket.status === filter),
  );
  return (
    <main className="main preview-tickets tk">
      <TicketsHeader
        searchRef={searchRef}
        text={search}
        onText={setSearch}
        onClear={() => setSearch('')}
        sourcesLabel="Jira"
        connected
        syncedAt="2026-10-25T00:00:00Z"
        failed={failed ? ['jira'] : []}
        refreshing={syncing}
        onRefresh={onSync}
      />
      <div className="preview-sync-demo">
        <span>Sync preview</span>
        {syncing ? (
          <>
            <span className="preview-muted">Try search, a ticket, or Chats while syncing.</span>
            <button onClick={() => onFinish(false)}>Complete sync</button>
            <button onClick={() => onFinish(true)}>Simulate failure</button>
          </>
        ) : (
          <>
            <span className="preview-muted">
              No page overlay. Existing tickets remain available.
            </span>
            <button onClick={onSync}>Start sync</button>
          </>
        )}
      </div>
      {failed && (
        <div className="preview-sync-error" role="status">
          <Glyph name="warn" />
          <span>Jira couldn’t be reached. Showing your last synced tickets.</span>
          <button onClick={onSync}>Retry</button>
        </div>
      )}
      <div className="preview-ticket-layout">
        <aside className="preview-ticket-views">
          <small>Views</small>
          {['Inbox', 'In progress', 'In review'].map((name) => (
            <button key={name} aria-pressed={name === filter} onClick={() => setFilter(name)}>
              <Glyph name={name === 'Inbox' ? 'box' : name === 'In review' ? 'pr' : 'play'} />
              {name}
              <span>{name === 'Inbox' ? 4 : name === 'In review' ? 3 : 1}</span>
            </button>
          ))}
        </aside>
        <section className="preview-ticket-list">
          <h2>
            {filter} <span>{visible.length}</span>
          </h2>
          {visible.map((ticket) => (
            <button
              key={ticket.key}
              aria-pressed={ticket.key === selected.key}
              onClick={() => setSelected(ticket)}
            >
              <span className="preview-muted">{ticket.key}</span>
              <span>{ticket.title}</span>
              <span className="preview-success">✓ Checks passing</span>
              <span>{ticket.pr}</span>
            </button>
          ))}
          {!visible.length && <p className="preview-muted">No tickets match your search.</p>}
        </section>
        <aside className="preview-ticket-detail">
          <small className="preview-muted">Jira · {selected.key}</small>
          <h2>{selected.title}</h2>
          <button className="preview-primary" onClick={onChat}>
            <Glyph name="chat" />
            Open chat
          </button>
          <dl>
            <dt>Status</dt>
            <dd>{selected.status}</dd>
            <dt>Priority</dt>
            <dd>Medium</dd>
            <dt>Project</dt>
            <dd>CP</dd>
            <dt>Assignee</dt>
            <dd>Alex Rivera (you)</dd>
          </dl>
          <h3>Linked work</h3>
          <button className="preview-pr" onClick={onChat}>
            <Glyph name="pr" />
            <span>
              {selected.pr} · orders-web-app<small>✓ Checks passing · Waiting for review</small>
            </span>
          </button>
          <h3>Description</h3>
          <p>
            Review the implementation, address feedback, and verify the experience in the browser.
          </p>
          <p className="preview-muted">Sample ticket data for interaction review.</p>
        </aside>
      </div>
    </main>
  );
}
