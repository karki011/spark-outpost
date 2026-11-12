import { useRef } from 'react';
import {
  MEETING_ATTACHMENTS_MAX,
  MEETING_GOAL_MAX,
  MEETING_USER_NOTES_MAX,
  type MeetingDetail,
} from '@spark-outpost/contracts';
import { formatBytes } from '../api/attachments.ts';
import { PlusIcon, XIcon } from '../ui/icons.tsx';
import { useAttachFiles, useDetachFile, usePatchMeeting } from './use-meetings.ts';
import { useSavedField } from './use-saved-field.ts';

const ACCEPT = 'text/*,.md,.txt,.csv,.json,.pdf,application/pdf,image/*';

function SavedStatus({ failed }: { failed: boolean }) {
  return failed ? <span role="alert">Not saved yet. It will retry as you type.</span> : null;
}

export function ContextPane({ detail }: { detail: MeetingDetail }) {
  const { meeting, attachments } = detail;
  const patch = usePatchMeeting(meeting.id);
  const attach = useAttachFiles(meeting.id);
  const detach = useDetachFile(meeting.id);
  const picker = useRef<HTMLInputElement>(null);
  const goal = useSavedField(meeting.goal, (value) => patch.mutateAsync({ goal: value }));
  const notes = useSavedField(meeting.userNotes, (value) =>
    patch.mutateAsync({ userNotes: value }),
  );
  const full = attachments.length >= MEETING_ATTACHMENTS_MAX;

  return (
    <div className="mt-context">
      <label className="field">
        <span>Goal</span>
        <input
          className="inp"
          maxLength={MEETING_GOAL_MAX}
          placeholder="What do you want out of this meeting?"
          value={goal.value}
          onChange={(event) => goal.change(event.target.value)}
          onBlur={goal.flush}
        />
        <SavedStatus failed={goal.failed} />
      </label>
      <label className="field">
        <span>Your notes</span>
        <textarea
          className="inp mt-textarea"
          maxLength={MEETING_USER_NOTES_MAX}
          placeholder="Anything you want the notes to take into account"
          value={notes.value}
          onChange={(event) => notes.change(event.target.value)}
          onBlur={notes.flush}
        />
        <SavedStatus failed={notes.failed} />
      </label>
      <section aria-label="Attached files">
        <h3 className="mt-subhead">
          Files <span className="mt-count">{attachments.length}</span>
        </h3>
        {attachments.length > 0 && (
          <ul className="mt-files">
            {attachments.map((file) => (
              <li key={file.id} className="mt-file">
                <span className="mt-file-name">{file.name}</span>
                <span className="mt-file-size">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className="btn ghost sm"
                  aria-label={`Remove ${file.name}`}
                  disabled={detach.isPending}
                  onClick={() => detach.mutate(file.id)}
                >
                  <XIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept={ACCEPT}
          aria-label="Choose files to add"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])].slice(
              0,
              MEETING_ATTACHMENTS_MAX - attachments.length,
            );
            event.target.value = '';
            files.reduce(
              (chain, file) => chain.then(() => attach.mutateAsync(file).catch(() => undefined)),
              Promise.resolve<unknown>(undefined),
            );
          }}
        />
        <button
          type="button"
          className="btn line sm"
          disabled={full || attach.isPending}
          onClick={() => picker.current?.click()}
        >
          <PlusIcon />
          {attach.isPending ? 'Adding…' : 'Add context…'}
        </button>
        {full && (
          <p className="mt-hint">A meeting holds at most {MEETING_ATTACHMENTS_MAX} files.</p>
        )}
        {attach.isError && <p role="alert">Couldn’t add the file. {attach.error.message}</p>}
        {detach.isError && <p role="alert">Couldn’t remove the file. {detach.error.message}</p>}
      </section>
    </div>
  );
}
