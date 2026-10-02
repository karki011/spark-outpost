import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
  type UIEvent,
} from 'react';
import type { ChangeEntry, ChangeRunSummary } from '@spark-outpost/contracts';
import { useDebouncedValue } from '../../ui/use-debounced-value.ts';
import { FILE_PAGE_SIZE } from '../diff-api.ts';
import { fileIndexAt, flatRows, groupedRows, parentRow, type TreeRow } from '../file-rows.ts';
import { pagesInRange, revealScrollTop, visibleRange } from '../virtual-window.ts';
import { FileRowView, FolderRowView, SkeletonRow } from './FileRows.tsx';
import { useFilePages, useFirstPage } from './use-file-pages.ts';

const ROW_HEIGHT = 30;
const OVERSCAN = 8;
const FIRST_SKELETONS = 12;

export function entryKey(entry: Pick<ChangeEntry, 'runId' | 'path'>): string {
  return `${entry.runId}:${entry.path}`;
}

interface FileListProps {
  taskId: string;
  version: string | undefined;
  runs: readonly ChangeRunSummary[];
  selected: string | null;
  onSelect(entry: ChangeEntry): void;
  treeRef: Ref<HTMLDivElement>;
}

function useViewport(scroller: RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState({ top: 0, height: 600 });
  const frame = useRef(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setView((current) => ({ ...current, height: element.clientHeight })),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [scroller]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setView({ top: element.scrollTop, height: element.clientHeight });
    });
  };
  return { view, onScroll };
}

function runLabels(runs: readonly ChangeRunSummary[]): Map<string, string> {
  const live = runs.filter((run) => !run.revertedAt);
  if (live.length < 2) return new Map();
  return new Map(live.map((run, index) => [run.runId, run.name ?? `Run ${index + 1}`]));
}

export function FileList({ taskId, version, runs, selected, onSelect, treeRef }: FileListProps) {
  const [filter, setFilter] = useState('');
  const q = useDebouncedValue(filter.trim(), 150);
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState(0);
  const [shownQuery, setShownQuery] = useState(q);
  const scroller = useRef<HTMLDivElement>(null);
  const { view, onScroll } = useViewport(scroller);
  const first = useFirstPage(taskId, version, q);
  const total = first.data?.total ?? 0;
  const folders = first.data?.folders;
  const model = useMemo(
    () => (grouped && folders ? groupedRows(folders, collapsed) : flatRows(total)),
    [grouped, folders, collapsed, total],
  );
  if (shownQuery !== q) {
    setShownQuery(q);
    setActive(0);
  }
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [q, grouped]);
  const range = visibleRange({
    scrollTop: view.top,
    viewport: view.height,
    rowHeight: ROW_HEIGHT,
    count: model.count,
    overscan: OVERSCAN,
  });
  const pages = pagesInRange(range, (row) => fileIndexAt(model, row), FILE_PAGE_SIZE);
  const fileAt = useFilePages(taskId, version, q, first.data, pages);
  const labels = runLabels(runs);
  const current = Math.min(active, Math.max(0, model.count - 1));

  const reveal = (row: number) => {
    const element = scroller.current;
    if (!element) return;
    const top = revealScrollTop(row, ROW_HEIGHT, element.scrollTop, element.clientHeight);
    if (top !== element.scrollTop) element.scrollTop = top;
  };
  const move = (row: number) => {
    if (model.count === 0) return;
    const next = Math.min(model.count - 1, Math.max(0, row));
    setActive(next);
    reveal(next);
  };
  const toggleFolder = (path: string, open: boolean) => {
    setCollapsed((shut) => {
      const next = new Set(shut);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const activate = (row: TreeRow, index: number) => {
    setActive(index);
    if (row.kind === 'folder') toggleFolder(row.path, row.collapsed);
    else {
      const entry = fileAt(row.index);
      if (entry) onSelect(entry);
    }
  };

  const latest = useRef({ model, activate });
  useEffect(() => {
    latest.current = { model, activate };
  });
  const onRowClick = useCallback((index: number) => {
    const { model: rows, activate: open } = latest.current;
    open(rows.at(index), index);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (model.count === 0) return;
    const row = model.at(current);
    const page = Math.max(1, Math.floor(view.height / ROW_HEIGHT) - 1);
    const moves: Record<string, () => void> = {
      ArrowDown: () => move(current + 1),
      ArrowUp: () => move(current - 1),
      Home: () => move(0),
      End: () => move(model.count - 1),
      PageDown: () => move(current + page),
      PageUp: () => move(current - page),
      Enter: () => activate(row, current),
      ' ': () => activate(row, current),
      ArrowRight: () => {
        if (row.kind === 'folder' && row.collapsed) toggleFolder(row.path, true);
        else if (row.kind === 'folder') move(current + 1);
      },
      ArrowLeft: () => {
        if (row.kind === 'folder' && !row.collapsed) toggleFolder(row.path, false);
        const parent = parentRow(model, current);
        if (parent !== null) move(parent);
      },
    };
    const action = moves[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const rows = [];
  for (let index = range.start; index < range.end; index++) {
    const row = model.at(index);
    const id = `dd-row-${index}`;
    const top = index * ROW_HEIGHT;
    const isActive = index === current;
    const placed = {
      index,
      top,
      active: isActive,
      position: row.position,
      setSize: row.setSize,
      onActivate: onRowClick,
    };
    if (row.kind === 'folder') {
      rows.push(
        <FolderRowView
          key={`f:${row.path}`}
          {...placed}
          path={row.path}
          count={row.count}
          collapsed={row.collapsed}
        />,
      );
      continue;
    }
    const entry = fileAt(row.index);
    rows.push(
      entry ? (
        <FileRowView
          key={entryKey(entry)}
          {...placed}
          level={row.level}
          entry={entry}
          selected={selected === entryKey(entry)}
          run={labels.get(entry.runId) ?? null}
        />
      ) : (
        <SkeletonRow key={`s:${row.index}`} id={id} row={row} top={top} />
      ),
    );
  }

  const loading = first.isPending;
  const shownRow = !loading && current >= range.start && current < range.end;
  return (
    <div className="dd-files">
      <div className="dd-files-tools">
        <input
          type="search"
          className="inp dd-filter"
          placeholder="Filter files"
          aria-label="Filter files"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button
          type="button"
          className="dd-tool"
          aria-pressed={grouped}
          onClick={() => setGrouped(!grouped)}
        >
          Folders
        </button>
      </div>
      <p className="dd-files-count" aria-live="polite">
        {loading ? '' : `${total.toLocaleString('en-US')} ${total === 1 ? 'file' : 'files'}`}
      </p>
      <div
        ref={treeRef}
        className="dd-tree"
        role="tree"
        aria-label="Changed files"
        aria-busy={loading || undefined}
        aria-activedescendant={shownRow ? `dd-row-${current}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div ref={scroller} className="dd-tree-scroll" onScroll={onScroll}>
          <div
            className="dd-tree-space"
            style={{ height: (loading ? FIRST_SKELETONS : model.count) * ROW_HEIGHT }}
          >
            {loading
              ? Array.from({ length: FIRST_SKELETONS }, (_, index) => (
                  <SkeletonRow
                    key={index}
                    id={`dd-skel-${index}`}
                    row={null}
                    top={index * ROW_HEIGHT}
                  />
                ))
              : rows}
          </div>
        </div>
        {!loading && total === 0 && (
          <p className="dd-files-empty">{q ? 'No files match.' : 'No file changes yet.'}</p>
        )}
      </div>
    </div>
  );
}
