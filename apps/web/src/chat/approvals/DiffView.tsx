import '../markdown/code-tokens.css';
import './diff-view.css';
import { useEffect, useMemo, useState } from 'react';
import type { FileDiff } from '@spark-outpost/contracts';
import {
  highlightLines,
  languageForPath,
  type CodeToken,
  type Language,
} from '../markdown/highlighter.ts';
import { formatCount } from '../changes/change-rules.ts';
import { foldRows, paintLine, shownRows, type DiffRow } from './diff-model.ts';
import { useDiffModel } from './use-diff-model.ts';

const MARKS = { add: '+', remove: '−', same: ' ' } as const;
const CHANGE_LABELS = { add: 'Added', remove: 'Removed' } as const;
const CHUNK_ROWS = 300;
const HIGHLIGHT_MAX_CHARS = 200 * 1024;
const SKELETON_WIDTHS = ['62%', '48%', '71%', '35%', '56%'];

function highlightable(diff: FileDiff): boolean {
  return (diff.oldText?.length ?? 0) + diff.newText.length <= HIGHLIGHT_MAX_CHARS;
}

interface Highlighted {
  oldText: string | null;
  newText: string;
  before: CodeToken[][];
  after: CodeToken[][];
}

function useHighlighted(diff: FileDiff, language: Language | null): Highlighted | null {
  const [state, setState] = useState<Highlighted | null>(null);
  const { oldText, newText } = diff;
  useEffect(() => {
    if (!language) return;
    let current = true;
    Promise.all([
      oldText === null ? Promise.resolve([]) : highlightLines(oldText, language),
      highlightLines(newText, language),
    ])
      .then(([before, after]) => {
        if (current) setState({ oldText, newText, before, after });
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [oldText, newText, language]);
  return state && state.oldText === oldText && state.newText === newText ? state : null;
}

function rowTokens(row: DiffRow, highlighted: Highlighted | null): CodeToken[] | null {
  if (!highlighted) return null;
  if (row.kind === 'remove') return highlighted.before[row.oldNo! - 1] ?? null;
  return highlighted.after[row.newNo! - 1] ?? null;
}

export function DiffLine({
  row,
  highlighted = null,
}: {
  row: DiffRow;
  highlighted?: Highlighted | null;
}) {
  const segments = paintLine(row.text, rowTokens(row, highlighted), row.words);
  return (
    <tr className={`dv-row ${row.kind}`}>
      <td className="dv-n">{row.oldNo ?? ''}</td>
      <td className="dv-n">{row.newNo ?? ''}</td>
      <td className="dv-m">
        <span aria-hidden="true">{MARKS[row.kind]}</span>
        {row.kind !== 'same' && <span className="sr-only">{CHANGE_LABELS[row.kind]}</span>}
      </td>
      <td className="dv-c">
        {segments.map((segment, index) => (
          <span
            key={index}
            className={segment.changed ? 'dv-w' : undefined}
            style={segment.color ? { color: segment.color } : undefined}
          >
            {segment.text}
          </span>
        ))}
        {'\n'}
      </td>
    </tr>
  );
}

function MoreRow({ count, onMore }: { count: number; onMore: () => void }) {
  const next = Math.min(count, CHUNK_ROWS);
  return (
    <tr className="dv-fold dv-more">
      <td colSpan={4}>
        <button type="button" onClick={onMore}>
          Show {next === count ? '' : `${next} of `}
          {count.toLocaleString('en-US')} more {count === 1 ? 'line' : 'lines'}
        </button>
      </td>
    </tr>
  );
}

function FoldRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <tr className="dv-fold">
      <td colSpan={4}>
        <button type="button" onClick={onOpen}>
          Show {count} unchanged {count === 1 ? 'line' : 'lines'}
        </button>
      </td>
    </tr>
  );
}

function DiffSkeleton() {
  return (
    <div className="dv-skel" aria-hidden="true">
      {SKELETON_WIDTHS.map((width) => (
        <span key={width} style={{ width }} />
      ))}
    </div>
  );
}

export function DiffView({ diff, fullPath }: { diff: FileDiff; fullPath?: string | undefined }) {
  const model = useDiffModel(diff.oldText, diff.newText);
  const blocks = useMemo(() => (model ? foldRows(model.rows) : []), [model]);
  const highlighted = useHighlighted(diff, highlightable(diff) ? languageForPath(diff.path) : null);
  const [wrap, setWrap] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [limit, setLimit] = useState(CHUNK_ROWS);
  const open = (index: number) => setOpened((current) => new Set(current).add(index));
  const shown = shownRows(blocks, opened, limit);

  return (
    <figure className="appr-diff dv">
      <figcaption>
        <code title={fullPath}>{diff.path}</code>
        {diff.oldText === null && <span className="dv-badge">New file</span>}
        {model && (
          <span className="appr-count">
            <span className="plus">+{formatCount(model.added)}</span>{' '}
            <span className="minus">−{formatCount(model.removed)}</span>
          </span>
        )}
        <button
          type="button"
          className="dv-wrap"
          aria-pressed={wrap}
          title="Wrap long lines"
          onClick={() => setWrap(!wrap)}
        >
          Wrap
        </button>
      </figcaption>
      <div
        className={wrap ? 'dv-body wrap' : 'dv-body'}
        role="region"
        aria-label={`Changes to ${diff.path}`}
        aria-busy={model ? undefined : true}
        tabIndex={0}
      >
        {!model && <DiffSkeleton />}
        <table>
          <tbody>
            {shown.items.map((item) =>
              item.type === 'fold' ? (
                <FoldRow
                  key={`fold:${item.index}`}
                  count={item.count}
                  onOpen={() => open(item.index)}
                />
              ) : (
                <DiffLine
                  key={`${item.row.oldNo}:${item.row.newNo}`}
                  row={item.row}
                  highlighted={highlighted}
                />
              ),
            )}
            {shown.hidden > 0 && (
              <MoreRow count={shown.hidden} onMore={() => setLimit(limit + CHUNK_ROWS)} />
            )}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
