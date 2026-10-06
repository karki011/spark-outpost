import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DIFF_FIRST_LINES, type ChangeEntry } from '@spark-outpost/contracts';
import { BlobScout } from '../../brand/BlobScout.tsx';
import {
  fileView,
  formatBytes,
  formatLines,
  type FileView,
} from '../../chat/changes/change-rules.ts';
import { Counts, changeTag, splitPath } from '../../chat/changes/FileChangeList.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import { diffApi, diffKeys } from '../diff-api.ts';
import { CodeDiff } from './CodeDiff.tsx';
import { usePhone } from '../../ui/breakpoints.ts';
import type { DiffMode } from './code-view.ts';

const MODES = [
  { id: 'unified', label: 'Unified' },
  { id: 'split', label: 'Split' },
];

function hiddenNote(entry: ChangeEntry, view: FileView): string | null {
  const size = formatBytes(entry.bytes ?? 0);
  if (view === 'binary') return `Binary file changed · ${size}`;
  if (view === 'oversized') return `Too large to show here · ${size}. Open it in your editor.`;
  if (view === 'huge') return `Large file · ${size} · diff hidden`;
  if (view === 'generated') return 'Generated file · diff hidden';
  return null;
}

interface DiffBodyProps {
  taskId: string;
  version: string | undefined;
  entry: ChangeEntry;
  mode: DiffMode;
  wrap: boolean;
}

function DiffBody({ taskId, version, entry, mode, wrap }: DiffBodyProps) {
  const [view] = useState(() => fileView(entry));
  const [revealed, setRevealed] = useState(false);
  const [full, setFull] = useState(false);
  const note = hiddenNote(entry, view);
  const canReveal = view === 'huge' || view === 'generated';
  const showing = note === null || (revealed && canReveal);
  const lines = full ? null : DIFF_FIRST_LINES;
  const params = { version, runId: entry.runId, path: entry.path, lines };
  const diff = useQuery({
    queryKey: diffKeys.file(taskId, params),
    queryFn: () => diffApi.file(taskId, params),
    enabled: showing,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  if (!showing) {
    return (
      <div className="dd-hidden">
        <span>{note}</span>
        {canReveal && (
          <button type="button" className="btn sm line" onClick={() => setRevealed(true)}>
            Show diff
          </button>
        )}
      </div>
    );
  }
  if (diff.isError) {
    return (
      <div className="dd-state" role="alert">
        <BlobScout size={40} mood="sad" />
        <p>{diff.error.message}</p>
      </div>
    );
  }
  if (!diff.data) {
    return (
      <div className="dd-code-wrap" aria-busy="true">
        <Skeleton label="Loading the diff" shape="diff" rows={10} className="dd-code-skel" />
      </div>
    );
  }
  const data = diff.data;
  const longest = Math.max(data.oldLines, data.newLines);
  return (
    <>
      {data.limited && (
        <div className="dd-limit" role="status">
          <span>
            Showing the first {formatLines(DIFF_FIRST_LINES)} of {formatLines(longest)}.
          </span>
          <button
            type="button"
            className="btn sm line"
            disabled={full}
            onClick={() => setFull(true)}
          >
            {full ? 'Loading the full file' : 'Load full file'}
          </button>
        </div>
      )}
      <div className="dd-code-wrap" aria-busy={diff.isFetching || undefined}>
        <CodeDiff diff={data} mode={mode} wrap={wrap} />
      </div>
    </>
  );
}

interface DiffPaneProps {
  taskId: string;
  version: string | undefined;
  entry: ChangeEntry | null;
  mode: DiffMode;
  wrap: boolean;
  onMode(mode: DiffMode): void;
  onWrap(wrap: boolean): void;
}

export function DiffPane({ taskId, version, entry, mode, wrap, onMode, onWrap }: DiffPaneProps) {
  const phone = usePhone();
  if (!entry) {
    return (
      <section className="dd-pane" aria-label="Diff">
        <div className="dd-state">
          <BlobScout size={40} />
          <p>Pick a file to see what changed.</p>
        </div>
      </section>
    );
  }
  const [dir, name] = splitPath(entry.path);
  const tag = changeTag(entry);
  return (
    <section className="dd-pane" aria-label={`Diff of ${entry.path}`}>
      <header className="dd-pane-head">
        <span className="dd-pane-path" title={entry.path}>
          {entry.oldPath && <span className="dd-dir">{entry.oldPath} → </span>}
          <span className="dd-dir">{dir}</span>
          <b>{name}</b>
        </span>
        {tag && <span className={`chf-tag ${entry.oldPath ? '' : entry.change}`}>{tag}</span>}
        <Counts added={entry.added} removed={entry.removed} />
        <span className="dd-pane-tools">
          {!phone && (
            <Segmented
              ariaLabel="Diff layout"
              options={MODES}
              value={mode}
              onChange={(id) => onMode(id === 'split' ? 'split' : 'unified')}
            />
          )}
          <button
            type="button"
            className="dd-tool"
            aria-pressed={wrap}
            onClick={() => onWrap(!wrap)}
          >
            Wrap
          </button>
        </span>
      </header>
      <DiffBody
        key={`${entry.runId}:${entry.path}`}
        taskId={taskId}
        version={version}
        entry={entry}
        mode={phone ? 'unified' : mode}
        wrap={wrap}
      />
    </section>
  );
}
