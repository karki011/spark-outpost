import './meetings.css';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Meeting, MeetingDetail } from '@spark-outpost/contracts';
import { LiveElapsed } from '../ui/LiveElapsed.tsx';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';
import { ContextPane } from './ContextPane.tsx';
import { MeetingAsk } from './MeetingAsk.tsx';
import { MeetingActions } from './MeetingActions.tsx';
import { MeetingTitle } from './MeetingTitle.tsx';
import { NotesPane } from './NotesPane.tsx';
import { TranscriptPane } from './TranscriptPane.tsx';
import { formatStarted, lengthLabel, sourceLabel } from './meeting-format.ts';
import { useMeeting } from './use-meetings.ts';

type PaneId = 'notes' | 'transcript' | 'context';

interface MeetingPageProps {
  id: string;
  onStartChat: (meeting: Meeting, notesMarkdown: string) => void;
  onDeleted?: (() => void) | undefined;
  onOpenChat?: ((id: string) => void) | undefined;
}

function MetaLine({ meeting }: { meeting: Meeting }) {
  const recording = meeting.state === 'recording';
  return (
    <p className="mt-meta">
      <span>{formatStarted(meeting.startedAt)}</span>
      <span>
        {recording ? <LiveElapsed since={Date.parse(meeting.startedAt)} /> : lengthLabel(meeting)}
      </span>
      <span>{sourceLabel(meeting)}</span>
      {recording && (
        <span className="mt-live">
          <span className="mt-dot" aria-hidden="true" />
          Recording
        </span>
      )}
      {meeting.state === 'interrupted' && <span>Ended by restart</span>}
    </p>
  );
}

function PageTabs({
  base,
  detail,
  active,
  onChange,
}: {
  base: string;
  detail: MeetingDetail;
  active: PaneId;
  onChange: (pane: PaneId) => void;
}) {
  const tabs = useRef<Record<PaneId, HTMLButtonElement | null>>({
    notes: null,
    transcript: null,
    context: null,
  });
  const items: { id: PaneId; label: string; count: number | null }[] = [
    { id: 'notes', label: 'Notes', count: null },
    { id: 'transcript', label: 'Transcript', count: detail.meeting.lineCount },
    { id: 'context', label: 'Context', count: detail.attachments.length },
  ];

  function move(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = items[(index + step + items.length) % items.length];
    if (!next) return;
    onChange(next.id);
    tabs.current[next.id]?.focus();
  }

  return (
    <div className="mt-tabs" role="tablist" aria-label="Meeting sections">
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            tabs.current[item.id] = element;
          }}
          type="button"
          role="tab"
          id={`${base}-${item.id}`}
          aria-selected={active === item.id}
          aria-controls={`${base}-panel`}
          tabIndex={active === item.id ? 0 : -1}
          className="mt-tab-button"
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {item.label}
          {item.count !== null && item.count > 0 && <span className="mt-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

function MeetingView({ id, onStartChat, onDeleted, onOpenChat }: MeetingPageProps) {
  const query = useMeeting(id);
  const [picked, setPane] = useState<PaneId | null>(null);
  const base = useId();
  const detail = query.data;
  const pane = picked ?? (detail?.meeting.state === 'recording' ? 'transcript' : 'notes');

  if (!detail) {
    return query.isError ? (
      <p className="mt-hint" role="alert">
        Couldn’t open this meeting. {query.error.message}
      </p>
    ) : (
      <LoadingBlob size="md" className="mt-loading" line="Opening meeting…" />
    );
  }

  return (
    <article className="mt-page" aria-label={detail.meeting.title}>
      <header className="mt-page-head">
        <MeetingTitle meeting={detail.meeting} />
        <MetaLine meeting={detail.meeting} />
        <MeetingActions detail={detail} onStartChat={onStartChat} onDeleted={onDeleted} />
      </header>
      <PageTabs base={base} detail={detail} active={pane} onChange={setPane} />
      <div
        className="mt-pane"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-${pane}`}
      >
        {pane === 'notes' && <NotesPane detail={detail} />}
        {pane === 'transcript' && <TranscriptPane meeting={detail.meeting} />}
        {pane === 'context' && <ContextPane detail={detail} />}
      </div>
      <MeetingAsk meeting={detail.meeting} onOpenChat={onOpenChat} />
    </article>
  );
}

export function MeetingPage(props: MeetingPageProps) {
  return <MeetingView key={props.id} {...props} />;
}
