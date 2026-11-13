import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SPARK_INSTRUCTIONS_FILE, type CrewFileEntry } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { CheckIcon, PenIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';
import { clearFileDraft, setFileDraft, useFileDraft } from './file-drafts.ts';
import {
  fixedName,
  isSkillFile,
  renameProblem,
  saveFailure,
  textProblem,
  type SaveFailure,
} from './folder-model.ts';
import {
  latestHash,
  useCrewFile,
  useRemoveCrewFile,
  useRenameCrewFile,
  useSaveCrewFile,
} from './use-crew-files.ts';

interface FileEditorProps {
  sparkId: string;
  path: string;
  exists: boolean;
  files: readonly CrewFileEntry[];
  folderProblem: string | null;
  onMoved: (path: string) => void;
  onDeleted: () => void;
}

type Mode = 'edit' | 'rename' | 'delete';

function hintFor(path: string): string {
  if (path === SPARK_INSTRUCTIONS_FILE) {
    return 'These are the Spark’s instructions, added to every chat with it as your own. No length limit.';
  }
  if (isSkillFile(path)) {
    return 'The Spark sees this skill’s name and description, and reads the rest when it needs it.';
  }
  return 'The Spark can read this file when a skill or its instructions point to it.';
}

function SaveState({
  saving,
  edited,
  exists,
}: {
  saving: boolean;
  edited: boolean;
  exists: boolean;
}) {
  if (saving) {
    return (
      <span className="spk-state" role="status">
        <SpinnerIcon /> Saving…
      </span>
    );
  }
  if (edited) {
    return (
      <span className="spk-state" role="status">
        <PenIcon /> Edited
      </span>
    );
  }
  return (
    <span className="spk-state" role="status">
      {exists && <CheckIcon />} {exists ? 'Saved' : 'Not written yet'}
    </span>
  );
}

export function FileEditor({
  sparkId,
  path,
  exists,
  files,
  folderProblem,
  onMoved,
  onDeleted,
}: FileEditorProps) {
  const id = useId();
  const file = useCrewFile(sparkId, path, exists);
  const draft = useFileDraft(sparkId, path);
  const save = useSaveCrewFile(sparkId);
  const remove = useRemoveCrewFile(sparkId);
  const rename = useRenameCrewFile(sparkId);
  const [mode, setMode] = useState<Mode>('edit');
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [newPath, setNewPath] = useState(path);

  const loaded = file.data ?? null;
  const loadedHash = loaded?.hash ?? null;
  const text = draft?.text ?? loaded?.text ?? '';
  const baseHash = draft ? draft.baseHash : loadedHash;
  const edited = draft !== null;
  const loading = exists && file.isPending && !edited;
  const missing = file.error instanceof ApiError && file.error.status === 404;
  const loadProblem = file.error && !missing && !edited ? file.error.message : null;
  const problem = edited ? textProblem(path, text) : folderProblem;
  const moveProblem = renameProblem(path, newPath, files);

  const change = (next: string) => {
    setFailure(null);
    if (next === (loaded?.text ?? '') && baseHash === loadedHash) clearFileDraft(sparkId, path);
    else setFileDraft(sparkId, path, { text: next, baseHash });
  };
  const write = (hash: string | null) =>
    save.mutate(
      { path, text, baseHash: hash },
      {
        onSuccess: () => {
          clearFileDraft(sparkId, path);
          setFailure(null);
        },
        onError: (error) => setFailure(saveFailure(error, hash)),
      },
    );
  const saveNow = () => {
    if (edited && !problem && !save.isPending) write(baseHash);
  };
  const reload = () => {
    clearFileDraft(sparkId, path);
    setFailure(null);
    void file.refetch();
  };
  const overwrite = async () => {
    try {
      write(await latestHash(sparkId, path));
    } catch (error) {
      setFailure(saveFailure(error, baseHash));
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveNow();
    }
  };
  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (moveProblem || !loaded) return;
    rename.mutate(
      { from: path, to: newPath, text: loaded.text },
      { onSuccess: () => onMoved(newPath) },
    );
  };
  const confirmDelete = () =>
    remove.mutate(path, {
      onSuccess: () => {
        clearFileDraft(sparkId, path);
        onDeleted();
      },
    });

  return (
    <section className="spk-editor" aria-labelledby={`${id}-path`} onKeyDown={onKeyDown}>
      <header className="spk-editor-h">
        <h3 id={`${id}-path`} className="spk-path">
          {path}
        </h3>
        <SaveState saving={save.isPending} edited={edited} exists={exists} />
        <span className="spk-grow" />
        {!fixedName(path) && exists && (
          <button
            type="button"
            className="btn ghost sm"
            disabled={edited || !loaded}
            title={edited ? 'Save your changes before renaming.' : undefined}
            onClick={() => {
              setNewPath(path);
              setMode('rename');
            }}
          >
            Rename
          </button>
        )}
        {path !== SPARK_INSTRUCTIONS_FILE && exists && (
          <button type="button" className="btn ghost sm" onClick={() => setMode('delete')}>
            Delete
          </button>
        )}
        <button
          type="button"
          className="btn primary sm"
          disabled={!edited || problem !== null || save.isPending}
          onClick={saveNow}
        >
          Save
        </button>
      </header>
      {mode === 'rename' && (
        <form className="spk-inline" onSubmit={submitRename} noValidate>
          <label className="field spk-inline-field">
            <span>New path</span>
            <input
              className="inp mono"
              autoFocus
              value={newPath}
              spellCheck={false}
              aria-invalid={moveProblem !== null && newPath !== path}
              aria-describedby={`${id}-move`}
              onChange={(event) => setNewPath(event.target.value)}
            />
          </label>
          <button type="submit" className="btn primary sm" disabled={rename.isPending}>
            Rename
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setMode('edit')}>
            Cancel
          </button>
          <p id={`${id}-move`} className="spk-problem" role="alert">
            {newPath !== path && moveProblem}
            {rename.error && ` ${rename.error.message}`}
          </p>
        </form>
      )}
      {mode === 'delete' && (
        <div className="spk-inline" role="alertdialog" aria-label={`Delete ${path}`}>
          <p className="spk-inline-text">
            Delete <b>{path}</b>? This can’t be undone.
            {remove.error && ` Not deleted. ${remove.error.message}`}
          </p>
          <button
            type="button"
            className="btn danger sm"
            disabled={remove.isPending}
            onClick={confirmDelete}
          >
            Delete file
          </button>
          <button type="button" className="btn ghost sm" autoFocus onClick={() => setMode('edit')}>
            Cancel
          </button>
        </div>
      )}
      {failure && (
        <div className="spk-inline spk-conflict" role="alert">
          <p className="spk-inline-text">
            <WarnIcon /> {failure.text}
          </p>
          {failure.kind !== 'error' && (
            <>
              <button type="button" className="btn line sm" onClick={reload}>
                Reload
              </button>
              <button type="button" className="btn ghost sm" onClick={() => void overwrite()}>
                Save mine over it
              </button>
            </>
          )}
        </div>
      )}
      {loadProblem ? (
        <div className="spk-inline" role="alert">
          <p className="spk-inline-text">
            <WarnIcon /> Couldn’t open this file. {loadProblem}
          </p>
          <button type="button" className="btn line sm" onClick={() => void file.refetch()}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <Skeleton label={`Loading ${path}`} shape="lines" rows={6} className="spk-code-wait" />
      ) : (
        <textarea
          className="spk-code"
          aria-label={`Contents of ${path}`}
          aria-describedby={`${id}-hint`}
          aria-invalid={problem !== null}
          spellCheck={false}
          value={text}
          placeholder="Write here."
          onChange={(event) => change(event.target.value)}
        />
      )}
      <footer className="spk-editor-f">
        {problem && (
          <p className="spk-problem" role="status">
            <WarnIcon /> {problem}
          </p>
        )}
        <p id={`${id}-hint`} className="spk-hint">
          {hintFor(path)}
        </p>
      </footer>
    </section>
  );
}
