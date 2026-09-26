import './file-changes.css';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChangedFile } from '@spark-outpost/contracts';
import { taskApi, taskKeys } from '../../tasks/task-api.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { DiffView } from '../approvals/DiffView.tsx';
import { diffStatBar, fileView, formatCount, formatLines, type FileView } from './change-rules.ts';

export interface FileEntry {
  runId: string;
  file: ChangedFile;
}

const CHANGE_TAGS = { added: 'new', deleted: 'deleted', modified: null } as const;

function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf('/') + 1;
  return [path.slice(0, cut), path.slice(cut)];
}

function FilePath({ file }: { file: ChangedFile }) {
  const [dir, name] = splitPath(file.path);
  const title = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
  return (
    <code className="chf-p" title={title}>
      {file.oldPath && (
        <>
          <span className="chf-dir">{file.oldPath}</span>
          <span className="chf-arrow"> → </span>
        </>
      )}
      <span className="chf-dir">{dir}</span>
      {name}
    </code>
  );
}

export function Counts({ added, removed }: { added: number | null; removed: number | null }) {
  if (added === null || removed === null) return <span className="chf-n">—</span>;
  return (
    <span className="chf-n">
      <span className="plus">+{formatCount(added)}</span>{' '}
      <span className="minus">−{formatCount(removed)}</span>
    </span>
  );
}

export function DiffStat({ added, removed }: { added: number; removed: number }) {
  const bar = diffStatBar(added, removed);
  const cells = [
    ...Array<string>(bar.add).fill('a'),
    ...Array<string>(bar.remove).fill('r'),
    ...Array<string>(bar.empty).fill(''),
  ];
  return (
    <span className="dstat" aria-hidden="true">
      {cells.map((kind, index) => (
        <i key={index} className={kind} />
      ))}
    </span>
  );
}

function LoadedDiff({ taskId, entry }: { taskId: string; entry: FileEntry }) {
  const { runId, file } = entry;
  const full = useQuery({
    queryKey: taskKeys.changedFile(taskId, runId, file.path),
    queryFn: () => taskApi.changedFile(taskId, runId, file.path),
    staleTime: Infinity,
  });
  if (full.isPending) return <p className="chf-big">Loading the diff…</p>;
  if (full.isError) return <p className="chf-big bad">{full.error.message}</p>;
  if (full.data.shown !== 'text') {
    return <p className="chf-big">Too large to show here. Open it in your editor to review.</p>;
  }
  return (
    <DiffView
      diff={{ path: file.path, oldText: full.data.oldText, newText: full.data.newText ?? '' }}
    />
  );
}

function hiddenNote(view: FileView): { note: string; action: string } | null {
  if (view.kind === 'generated')
    return { note: 'Generated file · diff hidden', action: 'Show diff' };
  if (view.kind === 'large')
    return { note: `Large diff · ${formatLines(view.lines)}`, action: 'Load diff' };
  if (view.kind === 'truncated') {
    const lines = view.lines === null ? '' : ` · ${formatLines(view.lines)}`;
    return { note: `Large diff${lines}`, action: 'Load diff' };
  }
  return null;
}

function FileBody({ taskId, entry, view }: { taskId: string; entry: FileEntry; view: FileView }) {
  const [loaded, setLoaded] = useState(false);
  const { file } = entry;
  const hidden = hiddenNote(view);
  if (hidden && !loaded) {
    return (
      <div className="chf-big">
        <span>{hidden.note}</span>
        <button type="button" className="chf-load" onClick={() => setLoaded(true)}>
          {hidden.action}
        </button>
      </div>
    );
  }
  if (file.shown !== 'text') return <LoadedDiff taskId={taskId} entry={entry} />;
  return (
    <DiffView diff={{ path: file.path, oldText: file.oldText, newText: file.newText ?? '' }} />
  );
}

function Tag({ file, view }: { file: ChangedFile; view: FileView }) {
  if (view.kind === 'binary') return <span className="chf-note">Binary file changed</span>;
  if (view.kind === 'generated') return <span className="chf-note">generated</span>;
  if (file.oldPath) return <span className="chf-tag">renamed</span>;
  const tag = CHANGE_TAGS[file.change];
  return tag ? <span className={`chf-tag ${file.change}`}>{tag}</span> : null;
}

function FileRow({ taskId, entry }: { taskId: string; entry: FileEntry }) {
  const [open, setOpen] = useState(false);
  const { file } = entry;
  const view = fileView(file);
  const binary = view.kind === 'binary';
  return (
    <li className={open ? 'chf open' : 'chf'}>
      <div className="chf-row">
        {binary ? (
          <span className="chf-toggle">
            <span className="chf-chev" />
            <FilePath file={file} />
          </span>
        ) : (
          <button
            type="button"
            className="chf-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Close' : 'Open'} ${file.path}`}
            onClick={() => setOpen(!open)}
          >
            <span className="chf-chev">
              <ChevronIcon />
            </span>
            <FilePath file={file} />
          </button>
        )}
        <Tag file={file} view={view} />
        {!binary && <Counts added={file.added} removed={file.removed} />}
        {!binary && <DiffStat added={file.added ?? 0} removed={file.removed ?? 0} />}
      </div>
      {open && !binary && <FileBody taskId={taskId} entry={entry} view={view} />}
    </li>
  );
}

export function FileChangeList({
  taskId,
  entries,
}: {
  taskId: string;
  entries: readonly FileEntry[];
}) {
  return (
    <ul className="chf-list">
      {entries.map((entry) => (
        <FileRow key={`${entry.runId}:${entry.file.path}`} taskId={taskId} entry={entry} />
      ))}
    </ul>
  );
}
