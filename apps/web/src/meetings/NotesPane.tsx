import { useState } from 'react';
import { MEETING_NOTES_MAX, type MeetingDetail } from '@spark-outpost/contracts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { PenIcon, SpinnerIcon } from '../ui/icons.tsx';
import { useSaveNotes, useWriteNotes } from './use-meetings.ts';

function NotesEditor({ id, initial, onDone }: { id: string; initial: string; onDone: () => void }) {
  const save = useSaveNotes(id);
  const [draft, setDraft] = useState(initial);
  return (
    <div className="mt-edit">
      <textarea
        className="inp mt-textarea mt-notes-edit"
        aria-label="Edit notes"
        maxLength={MEETING_NOTES_MAX}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="mt-actions">
        <button
          type="button"
          className="btn primary sm"
          disabled={save.isPending}
          onClick={() => save.mutate(draft, { onSuccess: onDone })}
        >
          Save
        </button>
        <button type="button" className="btn ghost sm" onClick={onDone}>
          Cancel
        </button>
      </div>
      {save.isError && <p role="alert">Couldn’t save. {save.error.message}</p>}
    </div>
  );
}

export function NotesPane({ detail }: { detail: MeetingDetail }) {
  const { meeting, notes } = detail;
  const write = useWriteNotes(meeting.id);
  const [editing, setEditing] = useState(false);

  if (meeting.state === 'recording') {
    return <p className="mt-hint">Notes are written when the meeting ends.</p>;
  }
  if (meeting.notesState === 'writing') {
    return (
      <p className="mt-hint" role="status">
        <SpinnerIcon /> Writing notes…
      </p>
    );
  }
  if (meeting.notesState === 'ready' && notes) {
    if (editing) {
      return (
        <NotesEditor id={meeting.id} initial={notes.markdown} onDone={() => setEditing(false)} />
      );
    }
    return (
      <div className="mt-notes">
        <div className="mt-actions">
          <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>
            <PenIcon />
            Edit
          </button>
        </div>
        <Markdown text={notes.markdown} />
      </div>
    );
  }
  const failed = meeting.notesState === 'failed';
  return (
    <div className="mt-hint">
      <p role={failed ? 'alert' : undefined}>
        {failed
          ? `Notes failed. ${meeting.notesNote ?? 'No reason was given.'}`
          : (meeting.notesNote ?? 'No notes yet.')}
      </p>
      <button
        type="button"
        className="btn line sm"
        disabled={write.isPending}
        onClick={() => write.mutate()}
      >
        {write.isPending && <SpinnerIcon />}
        {failed ? 'Write again' : 'Write notes'}
      </button>
      {write.isError && <p role="alert">Couldn’t start writing. {write.error.message}</p>}
    </div>
  );
}
