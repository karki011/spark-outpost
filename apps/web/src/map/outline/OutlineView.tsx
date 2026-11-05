import './outline.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronIcon } from '../../ui/icons.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { folderOf } from '../file-kind.ts';
import { KindDot } from '../JevLabel.tsx';
import { CATEGORY_LABELS } from '../map-model.ts';
import { fileKey } from '../scene.ts';
import {
  outlineReveal,
  outlineRows,
  type OutlineRow,
  type OutlineSort,
  type OutlineSource,
} from './outline-model.ts';

export interface OutlineReveal {
  area: string;
  file?: { projectId: string; path: string };
  nonce: number;
}

interface OutlineViewProps {
  source: OutlineSource;
  label: string;
  reveal: OutlineReveal | null;
  require: (keys: readonly string[]) => void;
  onFile: (file: number) => void;
  onFocusFile: (file: number) => void;
}

const ROW = 40;
const OVERSCAN = 8;
const SORTS = [
  { id: 'importance', label: 'Importance' },
  { id: 'name', label: 'Name' },
  { id: 'files', label: 'Size' },
  { id: 'recent', label: 'Recent' },
];

const plural = (count: number, word: string) =>
  `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

function expandable(row: OutlineRow): row is Extract<OutlineRow, { expanded: boolean }> {
  return row.kind === 'project' || row.kind === 'group' || row.kind === 'area';
}

function Changed({ count }: { count: number }) {
  return count > 0 ? <span className="map-ol-changed">{count} changed</span> : null;
}

function RowBody({ row, source }: { row: OutlineRow; source: OutlineSource }) {
  const chevron = expandable(row) && (
    <span className={`map-ol-chev${row.expanded ? ' open' : ''}`} aria-hidden="true">
      <ChevronIcon />
    </span>
  );
  if (row.kind === 'project') {
    return (
      <>
        {chevron}
        <b>{row.name}</b>
        <span className="map-n">{plural(row.files, 'file')}</span>
      </>
    );
  }
  if (row.kind === 'group') {
    return (
      <>
        {chevron}
        <i className={`map-tier ${row.group.category}`} aria-hidden="true" />
        <b>{row.group.name}</b>
        <span className="map-ol-path">{row.group.pooled ? 'small areas' : row.group.path}</span>
        <Changed count={row.changed} />
        <span className="map-n">
          {plural(row.areas, 'area')} · {row.files.toLocaleString('en-US')}
        </span>
      </>
    );
  }
  if (row.kind === 'area') {
    return (
      <>
        {chevron}
        <i className={`map-tier ${row.area.category}`} aria-hidden="true" />
        <b>{row.area.name}</b>
        <span className="map-ol-cat">{CATEGORY_LABELS[row.area.category]}</span>
        <span className="map-ol-path">{row.area.root}</span>
        <Changed count={row.changed} />
        <span className="map-n">{row.area.fileCount.toLocaleString('en-US')}</span>
      </>
    );
  }
  if (row.kind === 'file') {
    const file = source.scene.files[row.file]!;
    return (
      <>
        <KindDot kind={file.kind} />
        <b className="map-mono">{file.name}</b>
        <span className="map-ol-path">{folderOf(file.path)}</span>
        {row.changed && <span className="map-ol-changed">changed</span>}
        <span className="map-n">{file.fanIn} depend</span>
      </>
    );
  }
  return <span className="map-sk" style={{ width: '38%' }} />;
}

function rowLabel(row: OutlineRow, source: OutlineSource): string | undefined {
  if (row.kind === 'group') {
    return `${row.group.name}, ${CATEGORY_LABELS[row.group.category]}, ${plural(row.areas, 'area')}, ${plural(row.files, 'file')}${row.changed ? `, ${row.changed} changed in this chat` : ''}`;
  }
  if (row.kind === 'area') {
    return `${row.area.name}, ${CATEGORY_LABELS[row.area.category]}, ${plural(row.area.fileCount, 'file')}${row.changed ? `, ${row.changed} changed in this chat` : ''}`;
  }
  if (row.kind === 'file') {
    const file = source.scene.files[row.file]!;
    return `${file.path}, ${plural(file.fanIn, 'file')} depend on this${row.changed ? ', changed in this chat' : ''}`;
  }
  if (row.kind === 'loading') return 'Files are loading';
  return undefined;
}

export function OutlineView({
  source,
  label,
  reveal,
  require,
  onFile,
  onFocusFile,
}: OutlineViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(source.projects.map((project) => `p:${project.projectId}`)),
  );
  const [sort, setSort] = useState<OutlineSort>('importance');
  const [active, setActive] = useState<string | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const wantFocus = useRef(false);

  const rows = useMemo(() => outlineRows(source, expanded, sort), [source, expanded, sort]);
  const indexOf = useMemo(() => new Map(rows.map((row, index) => [row.id, index])), [rows]);
  const activeIndex = active !== null ? (indexOf.get(active) ?? 0) : 0;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setView({ top: element.scrollTop, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const toggle = (row: OutlineRow) => {
    if (!expandable(row)) return;
    if (!row.expanded && row.kind === 'area') require([row.key]);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };

  const moveTo = (index: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (!row) return;
    setActive(row.id);
    wantFocus.current = true;
    const element = scrollRef.current;
    if (!element) return;
    const position = (indexOf.get(row.id) ?? 0) * ROW;
    if (position < element.scrollTop) element.scrollTop = position;
    else if (position + ROW > element.scrollTop + element.clientHeight) {
      element.scrollTop = position + ROW - element.clientHeight;
    }
  };

  useEffect(() => {
    if (!wantFocus.current || active === null) return;
    const element = scrollRef.current?.querySelector<HTMLElement>(
      `[data-row="${CSS.escape(active)}"]`,
    );
    if (!element) return;
    wantFocus.current = false;
    element.focus({ preventScroll: true });
  });

  const [handled, setHandled] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  if (reveal && reveal.nonce !== handled) {
    setHandled(reveal.nonce);
    const ids = outlineReveal(source.scene, source.groups, reveal.area);
    if (reveal.file) ids.push(reveal.area);
    const target = reveal.file
      ? `f:${fileKey(reveal.file.projectId, reveal.file.path)}`
      : reveal.area;
    setPending(target);
    setActive(target);
    setExpanded((previous) => new Set([...previous, ...ids]));
  }
  useEffect(() => {
    if (reveal?.file) require([reveal.area]);
  }, [reveal, require]);

  const scrolled = useRef(0);
  useEffect(() => {
    if (!pending || scrolled.current === handled) return;
    const index = indexOf.get(pending);
    if (index === undefined) return;
    scrolled.current = handled;
    const element = scrollRef.current;
    if (element) element.scrollTop = Math.max(0, index * ROW - element.clientHeight / 3);
    wantFocus.current = true;
  }, [indexOf, pending, handled]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[activeIndex];
    if (!row) return;
    const page = Math.max(1, Math.floor(view.height / ROW) - 1);
    const moves: Record<string, number> = {
      ArrowDown: activeIndex + 1,
      ArrowUp: activeIndex - 1,
      Home: 0,
      End: rows.length - 1,
      PageDown: activeIndex + page,
      PageUp: activeIndex - page,
    };
    if (event.key in moves) {
      event.preventDefault();
      moveTo(moves[event.key]!);
      return;
    }
    if (event.key === 'ArrowRight' && expandable(row)) {
      event.preventDefault();
      if (row.expanded) moveTo(activeIndex + 1);
      else toggle(row);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (expandable(row) && row.expanded) toggle(row);
      else if (row.parent) moveTo(indexOf.get(row.parent) ?? activeIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (row.kind === 'file') onFile(row.file);
      else toggle(row);
      return;
    }
    if ((event.key === 'f' || event.key === 'F') && row.kind === 'file') {
      event.preventDefault();
      onFocusFile(row.file);
    }
  };

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + view.height) / ROW) + OVERSCAN);
  const shown = rows.slice(first, last).map((row, offset) => [row, first + offset] as const);
  if (activeIndex < first || activeIndex >= last) {
    const row = rows[activeIndex];
    if (row) shown.push([row, activeIndex]);
  }
  const tabbable = rows[activeIndex]?.id;

  return (
    <div className="map-outline">
      <div className="map-outline-bar">
        <span id="map-outline-sort">Sort by</span>
        <Segmented
          ariaLabel="Sort by"
          options={SORTS}
          value={sort}
          onChange={(id) => setSort(id as OutlineSort)}
        />
      </div>
      <div
        ref={scrollRef}
        className="map-outline-scroll"
        onScroll={(event) =>
          setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
        }
      >
        <div
          role="tree"
          aria-label={label}
          className="map-outline-tree"
          style={{ height: rows.length * ROW }}
          onKeyDown={onKeyDown}
        >
          {shown.map(([row, index]) => (
            <div
              key={row.id}
              data-row={row.id}
              role="treeitem"
              aria-level={row.level}
              aria-setsize={row.setSize}
              aria-posinset={row.posInSet}
              aria-expanded={expandable(row) ? row.expanded : undefined}
              aria-selected={row.id === tabbable}
              aria-label={rowLabel(row, source)}
              aria-busy={row.kind === 'loading' || undefined}
              tabIndex={row.id === tabbable ? 0 : -1}
              className={`map-ol-row ${row.kind}`}
              style={{ top: index * ROW, paddingLeft: 12 + (row.level - 1) * 22 }}
              onFocus={() => setActive(row.id)}
              onClick={() => {
                setActive(row.id);
                if (row.kind === 'file') onFile(row.file);
                else toggle(row);
              }}
            >
              <RowBody row={row} source={source} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
