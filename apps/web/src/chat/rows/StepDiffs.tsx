import '../approvals/approval-card.css';
import type { StepDiff } from '@spark-outpost/contracts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { DiffView } from '../approvals/DiffView.tsx';
import { Counts } from '../changes/FileChangeList.tsx';
import { shownBefore, useCommandUi, type CommandUiStore } from '../commands/command-ui.ts';
import { usePaneId } from '../split/chat-pane.ts';

export function diffUiKey(itemKey: string, path: string): string {
  return `diff:${itemKey}:${path}`;
}

export function hasOpenedDiff(
  store: CommandUiStore | null,
  itemKey: string,
  diffs: readonly StepDiff[],
): boolean {
  return diffs.some((diff) => shownBefore(store, diffUiKey(itemKey, diff.path)));
}

const SHOWN_SEGMENTS = 3;

function shortPath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments.length > SHOWN_SEGMENTS ? segments.slice(-SHOWN_SEGMENTS).join('/') : path;
}

function WithheldDiff({ diff }: { diff: StepDiff }) {
  return (
    <div className="sdiff">
      <div className="sdiff-head sdiff-withheld">
        <code title={diff.path}>{shortPath(diff.path)}</code>
        <span>Contents hidden: secret file</span>
      </div>
    </div>
  );
}

function StepDiffItem({ itemKey, diff }: { itemKey: string; diff: StepDiff }) {
  const [ui, update] = useCommandUi(diffUiKey(itemKey, diff.path));
  const bodyId = usePaneId(`sdiff-${itemKey}-${diff.path}`.replace(/\s+/g, '-'));
  const open = ui.open === true;
  return (
    <div className="sdiff">
      <button
        type="button"
        className="sdiff-head"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => update({ open: !open })}
      >
        <ChevronIcon />
        <code title={diff.path}>{shortPath(diff.path)}</code>
        <Counts added={diff.added} removed={diff.removed} />
      </button>
      {open && (
        <div id={bodyId} className="sdiff-body">
          <DiffView
            diff={{ path: diff.path, oldText: diff.oldText ?? null, newText: diff.newText ?? '' }}
          />
          {diff.truncated && <p className="sdiff-note">Only part of this change is shown.</p>}
        </div>
      )}
    </div>
  );
}

export function StepDiffs({ itemKey, diffs }: { itemKey: string; diffs: readonly StepDiff[] }) {
  return (
    <>
      {diffs.map((diff) =>
        diff.withheld ? (
          <WithheldDiff key={diff.path} diff={diff} />
        ) : (
          <StepDiffItem key={diff.path} itemKey={itemKey} diff={diff} />
        ),
      )}
    </>
  );
}
