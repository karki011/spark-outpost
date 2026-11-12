import { useEffect, useRef, useState } from 'react';
import type { Meeting, MeetingDetail } from '@spark-outpost/contracts';
import { CopyIcon, SpinnerIcon, TrashIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { useDeleteMeeting, useStopMeeting, useWriteNotes } from './use-meetings.ts';

interface MeetingActionsProps {
  detail: MeetingDetail;
  onStartChat: (meeting: Meeting, notesMarkdown: string) => void;
  onDeleted: (() => void) | undefined;
}

function DeleteConfirm({
  meeting,
  onDeleted,
  onKeep,
}: {
  meeting: Meeting;
  onDeleted: (() => void) | undefined;
  onKeep: () => void;
}) {
  const remove = useDeleteMeeting();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <div className="mt-confirm" role="group" aria-label="Confirm delete">
      <p>
        Delete this meeting? Its transcript, notes and context are removed from this Mac for good.
      </p>
      <div className="mt-actions">
        <button
          type="button"
          className="btn line sm mt-danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate(meeting.id, { onSuccess: () => onDeleted?.() })}
        >
          Delete meeting
        </button>
        <button ref={keep} type="button" className="btn ghost sm" onClick={onKeep}>
          Keep
        </button>
      </div>
      {remove.isError && <p role="alert">Couldn’t delete. {remove.error.message}</p>}
    </div>
  );
}

export function MeetingActions({ detail, onStartChat, onDeleted }: MeetingActionsProps) {
  const { meeting, notes } = detail;
  const stop = useStopMeeting();
  const write = useWriteNotes(meeting.id);
  const [confirming, setConfirming] = useState(false);
  const copy = useCopyFeedback();
  const recording = meeting.state === 'recording';
  const markdown = notes?.markdown ?? '';

  return (
    <div className="mt-actions-block">
      <div className="mt-actions">
        {recording && (
          <button
            type="button"
            className="btn primary sm"
            disabled={stop.isPending}
            onClick={() => stop.mutate(meeting.id)}
          >
            Stop
          </button>
        )}
        <button
          type="button"
          className={recording ? 'btn line sm' : 'btn primary sm'}
          disabled={recording}
          onClick={() => onStartChat(meeting, markdown)}
        >
          Start a chat
        </button>
        {meeting.notesState === 'ready' && (
          <button
            type="button"
            className="btn line sm"
            disabled={write.isPending}
            onClick={() => write.mutate()}
          >
            {write.isPending && <SpinnerIcon />}
            Write again
          </button>
        )}
        {markdown && (
          <button type="button" className="btn ghost sm" onClick={() => copy.copy(markdown)}>
            <CopyIcon />
            {copyButtonText(copy.state)}
          </button>
        )}
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={confirming}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon />
          Delete…
        </button>
      </div>
      {write.isError && <p role="alert">Couldn’t start writing. {write.error.message}</p>}
      {stop.isError && <p role="alert">Couldn’t stop. {stop.error.message}</p>}
      {confirming && (
        <DeleteConfirm
          meeting={meeting}
          onDeleted={onDeleted}
          onKeep={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
