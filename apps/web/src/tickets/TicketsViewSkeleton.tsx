import './tickets.css';
import './ticket-flow.css';
import './ticket-search.css';
import { TicketsSkeleton } from './TicketsSkeleton.tsx';
import { useDensity } from './use-density.ts';

export function TicketsViewSkeleton() {
  const [density] = useDensity();
  return (
    <main
      className={density === 'compact' ? 'page tk compact' : 'page tk'}
      aria-labelledby="tk-title"
    >
      <header className="tk-head">
        <h2 id="tk-title">Tickets</h2>
        <div className="tk-find" aria-hidden="true" />
      </header>
      <TicketsSkeleton sourcesLabel="your trackers" />
    </main>
  );
}
