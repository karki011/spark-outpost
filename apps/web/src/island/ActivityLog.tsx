import { useLayoutEffect, useRef } from 'react';
import { formatCount } from '../chat/changes/change-rules.ts';
import type { ActivityLine, LineChange } from './home-model.ts';
import { tickUp } from './home-motion.ts';

function Mark({ state }: { state: ActivityLine['state'] }) {
  if (state === 'active') return <span className="isl-now-mark" aria-hidden="true" />;
  return (
    <svg className="isl-now-mark" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d={state === 'failed' ? 'm3 3 6 6m0-6-6 6' : 'm2.5 6.5 2.5 2.5 4.5-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

const STATE_WORDS: Record<ActivityLine['state'], string> = {
  done: 'Done',
  active: 'Now',
  failed: 'Failed',
};

export function ChangeCount({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="isl-now-count">
      {' '}
      <span className="plus">+{formatCount(added)}</span>{' '}
      <span className="minus">−{formatCount(removed)}</span>
    </span>
  );
}

function LineText({ line }: { line: ActivityLine }) {
  return (
    <>
      <Mark state={line.state} />
      <span className="sr-only">{STATE_WORDS[line.state]}: </span>
      <span className="isl-now-verb">{line.verb}</span>
      {line.target && (
        <>
          <span aria-hidden="true"> · </span>
          <span className="isl-now-target">{line.target}</span>
        </>
      )}
      {line.change && <ChangeCount added={line.change.added} removed={line.change.removed} />}
    </>
  );
}

function changeLabel(line: ActivityLine, change: LineChange): string {
  const what = `${line.verb} ${line.target ?? change.path}`;
  return `${what}, ${change.added} added, ${change.removed} removed. Show the change`;
}

interface ActivityLogProps {
  lines: ActivityLine[];
  reduced: boolean;
  onPeek: (change: LineChange) => void;
}

export function ActivityLog({ lines, reduced, onPeek }: ActivityLogProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const lastKey = lines.at(-1)?.key ?? null;
  const previous = useRef(lastKey);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = lastKey;
    const list = listRef.current;
    if (reduced || !list || before === null || before === lastKey) return;
    tickUp(list, list.firstElementChild?.getBoundingClientRect().height ?? 18);
  }, [lastKey, reduced]);

  return (
    <div className="isl-now-logwrap">
      <ol ref={listRef} className="isl-now-log" aria-label="Latest steps">
        {lines.map((line) => {
          const change = line.change;
          return (
            <li key={line.key} data-state={line.state} data-kind={line.kind}>
              {change ? (
                <button
                  type="button"
                  className="isl-now-row"
                  data-change={change.path}
                  aria-label={changeLabel(line, change)}
                  onClick={() => onPeek(change)}
                >
                  <LineText line={line} />
                </button>
              ) : (
                <LineText line={line} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
