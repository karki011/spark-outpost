import './diff-drawer.css';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { Counts, DiffStat } from '../../chat/changes/FileChangeList.tsx';
import { filesLabel } from '../../chat/changes/change-rules.ts';
import { CloseIcon } from '../../tasks/TaskIcons.tsx';
import { diffApi, diffKeys } from '../diff-api.ts';
import type { DiffMode } from './code-view.ts';
import { DiffPane } from './DiffPane.tsx';
import { DRAWER_DEFAULT_WIDTH, useDrawerWidth, usePref } from './drawer-prefs.ts';
import { DrawerResizer } from './DrawerResizer.tsx';
import { entryKey, FileList } from './FileList.tsx';

const MODES: readonly DiffMode[] = ['unified', 'split'];
const WRAPS = ['off', 'on'] as const;

interface DiffDrawerProps {
  taskId: string;
  target: ChangeEntry | null;
  onClose(): void;
}

export function DiffDrawer({ taskId, target, onClose }: DiffDrawerProps) {
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId),
    queryFn: () => diffApi.summary(taskId),
  });
  const [selected, setSelected] = useState<ChangeEntry | null>(target);
  const [seenTarget, setSeenTarget] = useState(target);
  if (target !== seenTarget) {
    setSeenTarget(target);
    if (target) setSelected(target);
  }
  const [mode, setMode] = usePref<DiffMode>('spark-outpost.diff-drawer.mode', MODES, 'unified');
  const [wrap, setWrap] = usePref('spark-outpost.diff-drawer.wrap', WRAPS, 'off');
  const [width, setWidth] = useDrawerWidth();
  const tree = useRef<HTMLDivElement>(null);
  const shown = width ?? DRAWER_DEFAULT_WIDTH;

  useEffect(() => {
    tree.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const focus = document.activeElement;
      const inside = focus?.closest('.dd');
      if (!inside && focus !== document.body) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const data = summary.data;
  const label = data ? `Changes · ${filesLabel(data.files)}` : 'Changes';
  return (
    <aside
      className="dd"
      role="dialog"
      aria-label={label}
      style={{ '--dd-w': `${shown}px` } as CSSProperties}
    >
      <DrawerResizer width={shown} onWidth={setWidth} />
      <header className="dd-head">
        <h2>Changes</h2>
        {data && (
          <span className="dd-total">
            {filesLabel(data.files)}
            <Counts added={data.added} removed={data.removed} />
            <DiffStat added={data.added} removed={data.removed} />
          </span>
        )}
        <button
          type="button"
          className="icon-btn dd-close"
          aria-label="Close changes"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="dd-body">
        <FileList
          taskId={taskId}
          version={data?.version}
          runs={data?.runs ?? []}
          selected={selected ? entryKey(selected) : null}
          onSelect={setSelected}
          treeRef={tree}
        />
        <DiffPane
          taskId={taskId}
          version={data?.version}
          entry={selected}
          mode={mode}
          wrap={wrap === 'on'}
          onMode={setMode}
          onWrap={(next) => setWrap(next ? 'on' : 'off')}
        />
      </div>
    </aside>
  );
}
