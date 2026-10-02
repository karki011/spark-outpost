import './file-changes.css';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { useViewChanges } from '../../tasks/view-changes.ts';
import { diffStatBar, fileView, formatCount, type FileView } from './change-rules.ts';

const CHANGE_TAGS = { added: 'new', deleted: 'deleted', modified: null } as const;

export function splitPath(path: string): [string, string] {
  const cut = path.lastIndexOf('/') + 1;
  return [path.slice(0, cut), path.slice(cut)];
}

function FilePath({ file }: { file: ChangeEntry }) {
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

export function changeTag(file: Pick<ChangeEntry, 'change' | 'oldPath'>): string | null {
  if (file.oldPath) return 'renamed';
  return CHANGE_TAGS[file.change];
}

function Tag({ file, view }: { file: ChangeEntry; view: FileView }) {
  if (view === 'binary') return <span className="chf-note">Binary file changed</span>;
  if (view === 'generated') return <span className="chf-note">generated</span>;
  const tag = changeTag(file);
  return tag ? <span className={`chf-tag ${file.oldPath ? '' : file.change}`}>{tag}</span> : null;
}

function FileRow({ taskId, file }: { taskId: string; file: ChangeEntry }) {
  const viewChanges = useViewChanges();
  const view = fileView(file);
  const binary = view === 'binary';
  return (
    <li className="chf">
      <div className="chf-row">
        <button
          type="button"
          className="chf-toggle"
          aria-label={`Open the diff of ${file.path}`}
          disabled={!viewChanges}
          onClick={() => viewChanges?.(taskId, file)}
        >
          <FilePath file={file} />
        </button>
        <Tag file={file} view={view} />
        {!binary && <Counts added={file.added} removed={file.removed} />}
        {!binary && <DiffStat added={file.added ?? 0} removed={file.removed ?? 0} />}
      </div>
    </li>
  );
}

export function FileChangeList({
  taskId,
  entries,
}: {
  taskId: string;
  entries: readonly ChangeEntry[];
}) {
  return (
    <ul className="chf-list">
      {entries.map((file) => (
        <FileRow key={`${file.runId}:${file.path}`} taskId={taskId} file={file} />
      ))}
    </ul>
  );
}
