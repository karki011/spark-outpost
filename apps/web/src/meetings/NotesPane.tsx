import { useState } from 'react';
import {
  MEETING_NOTES_MAX,
  meetingNotesVersion,
  type MeetingDetail,
  type MeetingNotes,
} from '@spark-outpost/contracts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { PenIcon, SpinnerIcon } from '../ui/icons.tsx';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { useSaveNotes, useWriteNotes } from './use-meetings.ts';

function NotesEditor(props: { id: string; notes: MeetingNotes; onDone: () => void }) {
  const { id, onDone } = props;
  const save = useSaveNotes(id);
  const [opened] = useState(props.notes);
  const [draft, setDraft] = useState(opened.markdown);
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
          onClick={() =>
            save.mutate(
              { markdown: draft, base: meetingNotesVersion(opened) },
              { onSuccess: onDone },
            )
          }
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
  if (editing && notes) {
    return <NotesEditor id={meeting.id} notes={notes} onDone={() => setEditing(false)} />;
  }
  if (meeting.notesState === 'writing') {
    return (
      <div className="mt-writing">
        <LoadingBlob size="md" line="Writing notes…" />
        <p className="mt-hint">
          Spark is reading the transcript. This usually takes under a minute.
        </p>
        <div aria-hidden="true">
          <Skeleton label="Notes are being written" shape="lines" rows={7} />
        </div>
      </div>
    );
  }
  if (meeting.notesState === 'ready' && notes) {
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
