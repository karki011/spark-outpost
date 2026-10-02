import { memo, type CSSProperties } from 'react';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { changeTag, splitPath } from '../../chat/changes/FileChangeList.tsx';
import { formatCount } from '../../chat/changes/change-rules.ts';
import { ChevronIcon } from '../../ui/icons.tsx';
import type { FileRow } from '../file-rows.ts';

const STATUS = {
  added: { letter: 'A', label: 'new' },
  modified: { letter: 'M', label: 'modified' },
  deleted: { letter: 'D', label: 'deleted' },
  renamed: { letter: 'R', label: 'renamed' },
} as const;

const SKELETON_WIDTHS = ['58%', '72%', '46%', '64%', '52%', '68%'];

function place(top: number): CSSProperties {
  return { transform: `translateY(${top}px)` };
}

function status(entry: ChangeEntry) {
  return STATUS[entry.oldPath ? 'renamed' : entry.change];
}

function rowLabel(entry: ChangeEntry, run: string | null): string {
  const parts = [entry.path, changeTag(entry) ?? 'modified'];
  if (entry.added === null || entry.removed === null) parts.push('binary');
  else {
    parts.push(`${entry.added.toLocaleString('en-US')} added`);
    parts.push(`${entry.removed.toLocaleString('en-US')} removed`);
  }
  if (run) parts.push(run);
  return parts.join(', ');
}

interface Placed {
  index: number;
  top: number;
  active: boolean;
  position: number;
  setSize: number;
  onActivate(index: number): void;
}

interface FolderRowViewProps extends Placed {
  path: string;
  count: number;
  collapsed: boolean;
}

export const FolderRowView = memo(function FolderRowView(props: FolderRowViewProps) {
  const { index, top, active, position, setSize, onActivate, path, count, collapsed } = props;
  return (
    <div
      id={`dd-row-${index}`}
      className={active ? 'dd-row dd-folder active' : 'dd-row dd-folder'}
      role="treeitem"
      aria-level={1}
      aria-posinset={position}
      aria-setsize={setSize}
      aria-expanded={!collapsed}
      aria-selected={false}
      style={place(top)}
      onClick={() => onActivate(index)}
    >
      <span className={collapsed ? 'dd-chev' : 'dd-chev open'} aria-hidden="true">
        <ChevronIcon />
      </span>
      <span className="dd-folder-name">{path || 'Top folder'}</span>
      <span className="dd-folder-count">{count.toLocaleString('en-US')}</span>
    </div>
  );
});

interface FileRowViewProps extends Placed {
  level: 1 | 2;
  entry: ChangeEntry;
  selected: boolean;
  run: string | null;
}

export const FileRowView = memo(function FileRowView(props: FileRowViewProps) {
  const { index, top, active, position, setSize, onActivate, level, entry, selected, run } = props;
  const [dir, name] = splitPath(entry.path);
  const mark = status(entry);
  const classes = ['dd-row', 'dd-file', level === 2 ? 'nested' : '', active ? 'active' : ''];
  return (
    <div
      id={`dd-row-${index}`}
      className={classes.filter(Boolean).join(' ')}
      role="treeitem"
      aria-level={level}
      aria-posinset={position}
      aria-setsize={setSize}
      aria-selected={selected}
      aria-label={rowLabel(entry, run)}
      title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
      style={place(top)}
      onClick={() => onActivate(index)}
    >
      <span className={`dd-status ${mark.label}`} aria-hidden="true">
        {mark.letter}
      </span>
      <span className="dd-file-name">
        {level === 1 && dir && <span className="dd-dir">{dir}</span>}
        {name}
      </span>
      {run && <span className="dd-run">{run}</span>}
      {entry.added !== null && entry.removed !== null ? (
        <span className="dd-n">
          <span className="plus">+{formatCount(entry.added)}</span>
          <span className="minus">−{formatCount(entry.removed)}</span>
        </span>
      ) : (
        <span className="dd-n">binary</span>
      )}
    </div>
  );
});

interface SkeletonRowProps {
  id: string;
  row: FileRow | null;
  top: number;
}

export function SkeletonRow({ id, row, top }: SkeletonRowProps) {
  const width = SKELETON_WIDTHS[Math.round(top / 30) % SKELETON_WIDTHS.length];
  return (
    <div
      id={id}
      className={row?.level === 2 ? 'dd-row dd-file nested' : 'dd-row dd-file'}
      role="treeitem"
      aria-level={row?.level ?? 1}
      aria-selected={false}
      aria-busy="true"
      aria-label="Loading file"
      style={place(top)}
    >
      <span className="dd-skel dd-skel-dot" />
      <span className="dd-skel" style={{ width }} />
    </div>
  );
}
