import '../chat/approvals/diff-view.css';
import { useMemo } from 'react';
import type { FileDiff } from '@spark-outpost/contracts';
import { DiffLine } from '../chat/approvals/DiffView.tsx';
import { useDiffModel } from '../chat/approvals/use-diff-model.ts';
import { firstHunk, moreLines, peekRows } from './island-diff.ts';

interface IslandDiffProps {
  diff: FileDiff;
  mode: 'peek' | 'hunk';
  label: string;
}

export function IslandDiff({ diff, mode, label }: IslandDiffProps) {
  const model = useDiffModel(diff.oldText, diff.newText);
  const shown = useMemo(() => {
    if (!model) return null;
    return mode === 'peek' ? peekRows(model) : firstHunk(model);
  }, [model, mode]);
  return (
    <div className="dv isl-diff" data-mode={mode}>
      <div
        className="dv-body isl-diff-body"
        role="region"
        aria-label={label}
        aria-busy={shown ? undefined : true}
        tabIndex={0}
      >
        {shown && shown.items.length === 0 && (
          <p className="isl-diff-none">No changed lines to show.</p>
        )}
        <table>
          <tbody>
            {shown?.items.map((item) =>
              item.type === 'fold' ? (
                <tr key={`fold:${item.index}`} className="isl-diff-gap">
                  <td colSpan={4}>
                    {item.count} unchanged {item.count === 1 ? 'line' : 'lines'}
                  </td>
                </tr>
              ) : (
                <DiffLine key={`${item.row.oldNo}:${item.row.newNo}`} row={item.row} />
              ),
            )}
            {shown && shown.hidden > 0 && (
              <tr className="isl-diff-gap isl-diff-more">
                <td colSpan={4}>{moreLines(shown.hidden)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
