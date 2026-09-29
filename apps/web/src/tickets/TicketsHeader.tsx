import { useEffect, useState, type RefObject } from 'react';
import { ticketSourceNames, type TicketSourceId } from '@spark-outpost/contracts';
import { XIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { Glyph } from './ticket-icons.tsx';

interface TicketsHeaderProps {
  searchRef: RefObject<HTMLInputElement | null>;
  text: string;
  onText: (text: string) => void;
  onClear: () => void;
  sourcesLabel: string;
  connected: boolean;
  syncedAt: string | null;
  failed: TicketSourceId[];
  refreshing: boolean;
  onRefresh: () => void;
}

const TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function SyncLine({
  syncedAt,
  failed,
  refreshing,
}: Pick<TicketsHeaderProps, 'syncedAt' | 'failed' | 'refreshing'>) {
  const now = useNow();
  if (refreshing) {
    return (
      <span className="synced" role="status">
        <i className="pdot" aria-hidden="true" />
        Syncing…
      </span>
    );
  }
  if (!syncedAt) return null;
  if (failed.length > 0) {
    return (
      <span className="synced bad">
        {failed.map((source) => ticketSourceNames[source]).join(' and ')} not synced
      </span>
    );
  }
  return <span className="synced">Synced {relativeTime(syncedAt, now)}</span>;
}

export function TicketsHeader({
  searchRef,
  text,
  onText,
  onClear,
  sourcesLabel,
  connected,
  syncedAt,
  failed,
  refreshing,
  onRefresh,
}: TicketsHeaderProps) {
  return (
    <header className="tk-head">
      <h2 id="tk-title">Tickets</h2>
      <div className="tk-find">
        <Glyph name="search" size={15} />
        <input
          ref={searchRef}
          type="search"
          value={text}
          disabled={!connected}
          aria-label={`Search all tickets in ${sourcesLabel}`}
          placeholder={`Search all tickets in ${sourcesLabel}`}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && text) {
              event.preventDefault();
              onClear();
            }
          }}
        />
        {text ? (
          <button type="button" className="icon-btn" aria-label="Clear search" onClick={onClear}>
            <XIcon />
          </button>
        ) : (
          <kbd className="kbd" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      {connected && (
        <div className="tk-right">
          <SyncLine syncedAt={syncedAt} failed={failed} refreshing={refreshing} />
          <button
            type="button"
            className="icon-btn"
            aria-label="Refresh tickets"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <Glyph name="redo" size={15} />
          </button>
        </div>
      )}
    </header>
  );
}
