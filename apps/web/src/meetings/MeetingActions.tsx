import { useRef, useState } from 'react';
import type { Meeting, MeetingDetail } from '@spark-outpost/contracts';
import { DisconnectDialog } from '../connectors/DisconnectDialog.tsx';
import { CopyIcon, SpinnerIcon, TrashIcon } from '../ui/icons.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { useDeleteMeeting, useStopMeeting, useWriteNotes } from './use-meetings.ts';

interface MeetingActionsProps {
  detail: MeetingDetail;
  onStartChat: (meeting: Meeting, notesMarkdown: string) => void;
  onDeleted: (() => void) | undefined;
}

function deleteCopy(meeting: Meeting) {
  return {
    title: `Delete “${meeting.title}”?`,
    text:
      meeting.state === 'recording'
        ? 'Recording stops, and the transcript, notes and context are removed from this Mac. You can’t undo this.'
        : 'Its transcript, notes and context are removed from this Mac. You can’t undo this.',
  };
}

export function MeetingActions({ detail, onStartChat, onDeleted }: MeetingActionsProps) {
  const { meeting, notes } = detail;
  const stop = useStopMeeting();
  const write = useWriteNotes(meeting.id);
  const remove = useDeleteMeeting();
  const [confirming, setConfirming] = useState(false);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const copy = useCopyFeedback();
  const recording = meeting.state === 'recording';
  const markdown = notes?.markdown ?? '';

  function keep() {
    setConfirming(false);
    deleteButton.current?.focus();
  }

  function confirmDelete() {
    setConfirming(false);
    remove.mutate(meeting.id, {
      onSuccess: () => onDeleted?.(),
      onError: () => deleteButton.current?.focus(),
    });
  }

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
          ref={deleteButton}
          type="button"
          className="btn ghost sm"
          aria-haspopup="dialog"
          disabled={remove.isPending}
          onClick={() => setConfirming(true)}
        >
          <TrashIcon />
          Delete…
        </button>
      </div>
      {write.isError && <p role="alert">Couldn’t start writing. {write.error.message}</p>}
      {stop.isError && <p role="alert">Couldn’t stop. {stop.error.message}</p>}
      {remove.isError && <p role="alert">Couldn’t delete. {remove.error.message}</p>}
      {confirming && (
        <DisconnectDialog
          copy={deleteCopy(meeting)}
          confirmLabel="Delete meeting"
          onCancel={keep}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
