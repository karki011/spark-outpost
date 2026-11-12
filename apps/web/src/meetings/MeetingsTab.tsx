import './meetings.css';
import { useState } from 'react';
import type { Meeting } from '@spark-outpost/contracts';
import { BackIcon, SearchIcon, SpinnerIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { MeetingPage } from './MeetingPage.tsx';
import { MeetingRow } from './MeetingRow.tsx';
import { TakeNotesButton } from './TakeNotesButton.tsx';
import { useMeetingList, useMeetingStatus } from './use-meetings.ts';

interface MeetingsTabProps {
  initialId?: string | null;
  onStartChat: (meeting: Meeting, notesMarkdown: string) => void;
}

function EmptyState({ searching, query }: { searching: boolean; query: string }) {
  const status = useMeetingStatus();
  if (searching) {
    return (
      <div className="mt-empty">
        <p>No meetings match “{query}”.</p>
      </div>
    );
  }
  return (
    <div className="mt-empty">
      <p className="mt-empty-title">No meetings yet</p>
      <p>
        A meeting you record appears here with its notes, transcript and context. Press{' '}
        <b>Take notes</b> on a calendar meeting, or <b>New meeting</b> above, to start one.
      </p>
      {status.data && !status.data.available && status.data.reason && (
        <p>Recording isn’t available: {status.data.reason}</p>
      )}
    </div>
  );
}

export function MeetingsTab({ initialId = null, onStartChat }: MeetingsTabProps) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialId);
  const list = useMeetingList(query);
  const searching = list.search !== '';

  return (
    <div className="mt mt-tab" data-open={openId ? 'true' : 'false'}>
      <section className="mt-side" aria-label="Meeting history">
        <div className="mt-side-head">
          <label className="mt-search">
            <SearchIcon />
            <span className="sr-only">Search meetings</span>
            <input
              type="search"
              className="inp"
              placeholder="Search titles, notes and transcripts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <TakeNotesButton label="New meeting" onStarted={(meeting) => setOpenId(meeting.id)} />
        </div>
        <QueryWait query={list} what="the meetings">
          <Skeleton label="Loading meetings" shape="list" rows={5} />
        </QueryWait>
        {list.data && list.items.length === 0 && !list.searching && (
          <EmptyState searching={searching} query={list.search} />
        )}
        {list.items.length > 0 && (
          <ul className="mt-list" aria-label="Meetings">
            {list.items.map((item) => (
              <MeetingRow
                key={item.meeting.id}
                item={item}
                selected={item.meeting.id === openId}
                onOpen={setOpenId}
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
            <button type="button" className="btn ghost sm mt-back" onClick={() => setOpenId(null)}>
              <BackIcon />
              Back
            </button>
            <MeetingPage id={openId} onStartChat={onStartChat} onDeleted={() => setOpenId(null)} />
          </>
        ) : (
          <p className="mt-hint mt-pick">Pick a meeting to see its notes and transcript.</p>
        )}
      </section>
    </div>
  );
}
