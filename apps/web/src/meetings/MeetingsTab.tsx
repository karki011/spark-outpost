import './meetings.css';
import { useCallback, useState } from 'react';
import type { Meeting } from '@spark-outpost/contracts';
import { EmptyScene } from '../brand/EmptyScene.tsx';
import { BackIcon, SearchIcon, SpinnerIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { MeetingPage } from './MeetingPage.tsx';
import { MeetingRow } from './MeetingRow.tsx';
import { TakeNotesButton } from './TakeNotesButton.tsx';
import { useMeetingList } from './use-meetings.ts';

interface MeetingsTabProps {
  openId: string | null;
  onOpen: (id: string | null) => void;
  onStartChat: (meeting: Meeting, notesMarkdown: string) => void;
}

function Splash({ onStarted }: { onStarted: (meeting: Meeting) => void }) {
  return (
    <div className="mt mt-tab mt-splash">
      <EmptyScene fill>
        <h2 className="mt-splash-title">Scout’s all ears</h2>
        <p className="mt-splash-line">
          Record a meeting and it lands here, written up while you get on with your day.
        </p>
        <ol className="mt-splash-steps">
          <li>
            Press <b>Take notes</b> on a calendar meeting, or <b>New meeting</b> for anything else.
          </li>
          <li>
            Spark listens on this Mac until you press <b>Stop</b>.
          </li>
          <li>
            You get <b>Notes</b>, the full <b>Transcript</b>, and the <b>Context</b> you added.
          </li>
        </ol>
        <TakeNotesButton label="New meeting" onStarted={onStarted} />
        <p className="mt-splash-note">Audio never leaves this Mac and is never saved.</p>
      </EmptyScene>
    </div>
  );
}

export function MeetingsTab({ openId, onOpen, onStartChat }: MeetingsTabProps) {
  const [query, setQuery] = useState('');
  const close = useCallback(() => onOpen(null), [onOpen]);
  const started = useCallback((meeting: Meeting) => onOpen(meeting.id), [onOpen]);
  const list = useMeetingList(query);
  const searching = list.search !== '';
  const none = list.data !== undefined && list.items.length === 0;

  if (none && !openId && query.trim() === '' && !searching) return <Splash onStarted={started} />;

  return (
    <div className="mt mt-tab" data-open={openId ? 'true' : 'false'}>
      <section className="mt-side" aria-label="Meeting history">
        <div className="mt-side-head">
          <label className="mt-search">
            <SearchIcon />
            <span className="sr-only">Search meetings by title, notes and transcript</span>
            <input
              type="search"
              className="inp"
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <TakeNotesButton label="New meeting" onStarted={started} />
        </div>
        <QueryWait query={list} what="the meetings">
          <Skeleton label="Loading meetings" shape="list" rows={5} />
        </QueryWait>
        {none && !list.searching && (
          <p className="mt-empty">
            {searching ? `No meetings match “${list.search}”.` : 'No meetings yet.'}
          </p>
        )}
        {list.items.length > 0 && (
          <ul className="mt-list" aria-label="Meetings">
            {list.items.map((item) => (
              <MeetingRow
                key={item.meeting.id}
                item={item}
                selected={item.meeting.id === openId}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <button
            type="button"
            className="btn line sm mt-more"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage && <SpinnerIcon />}
            Load more
          </button>
        )}
      </section>
      <section className="mt-main" aria-label="Open meeting">
        {openId ? (
          <>
            <button type="button" className="btn ghost sm mt-back" onClick={close}>
              <BackIcon />
              Back
            </button>
            <MeetingPage id={openId} onStartChat={onStartChat} onDeleted={close} />
          </>
        ) : (
          <p className="mt-hint mt-pick">Pick a meeting to see its notes and transcript.</p>
        )}
      </section>
    </div>
  );
}
