import { useState } from 'react';
import { ticketSourceNames, type TicketSourceId } from '@spark-outpost/contracts';
import { TicketConnectForm } from './TicketConnectForm.tsx';
import { LinearMark, TicketGlyph } from './ticket-icons.tsx';

export function ConnectTickets() {
  const [source, setSource] = useState<TicketSourceId | null>(null);
  return (
    <div className="tk-empty">
      <div>
        <span className="tk-big" aria-hidden="true">
          <TicketGlyph size={26} />
        </span>
        <h2>See your tickets here</h2>
        <p>
          Connect Linear or Jira and Spark sorts the tickets assigned to you into what needs you,
          what&rsquo;s in flight and what&rsquo;s next. Search covers every ticket you can see, and
          you can assign one to yourself.
        </p>
        {source ? (
          <section className="tk-connect-card" aria-label={`Connect ${ticketSourceNames[source]}`}>
            <h3>Connect {ticketSourceNames[source]}</h3>
            <TicketConnectForm source={source} onCancel={() => setSource(null)} />
          </section>
        ) : (
          <div className="tk-cta">
            <button type="button" className="btn primary" onClick={() => setSource('linear')}>
              <LinearMark />
              Connect Linear
            </button>
            <button type="button" className="btn line" onClick={() => setSource('jira')}>
              <TicketGlyph />
              Connect Jira
            </button>
          </div>
        )}
        <p className="tk-foot">
          Tokens stay in your macOS keychain. Spark changes a ticket only when you start work, open
          a draft PR or assign it to yourself.
        </p>
      </div>
    </div>
  );
}
