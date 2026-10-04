import { useLayoutEffect, useRef } from 'react';
import type { FileView as FileViewData } from '@spark-outpost/contracts';

interface FileViewProps {
  view: FileViewData;
  current: boolean;
}

const STATE_WORDS: Record<FileViewData['action'], [now: string, last: string]> = {
  read: ['Reading', 'Last read'],
  edit: ['Editing', 'Last edit'],
};

function folderOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

function rangeWords(view: FileViewData): string {
  const last = view.firstLine + Math.max(0, view.lines.length - 1);
  const shown = `Lines ${view.firstLine} to ${last} of ${view.name}`;
  if (!view.focus) return shown;
  const { from, to } = view.focus;
  return from === to ? `${shown}, line ${from} marked` : `${shown}, lines ${from} to ${to} marked`;
}

export function FileView({ view, current }: FileViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const state = STATE_WORDS[view.action][current ? 0 : 1];
  const folder = folderOf(view.path);
  const focusFrom = view.focus?.from ?? null;

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = 0;
  }, [view.path, view.firstLine, focusFrom]);

  return (
    <figure className="isl-file" aria-label={`${state}: ${view.name}`}>
      <figcaption className="isl-file-tab">
        <b className="isl-file-name">{view.name}</b>
        {folder && <span className="isl-file-path">{folder}</span>}
        <span className="isl-sp" />
        <span className="isl-file-state" data-current={current || undefined}>
          {state}
        </span>
      </figcaption>
      <div
        ref={bodyRef}
        className="isl-file-body"
        role="region"
        aria-label={rangeWords(view)}
        tabIndex={0}
      >
        {view.lines.length === 0 && <p className="isl-diff-none">This file is empty.</p>}
        <table>
          <tbody>
            {view.lines.map((line, index) => {
              const number = view.firstLine + index;
              const marked =
                view.focus !== null && number >= view.focus.from && number <= view.focus.to;
              return (
                <tr key={number} data-marked={marked || undefined}>
                  <td className="isl-file-n">{number}</td>
                  <td className="isl-file-c">
                    {line}
                    {'\n'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
