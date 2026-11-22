import './run-view.css';
import { CheckIcon, MinusIcon, SpinnerIcon, WarnIcon } from '../ui/icons.tsx';
import type { ActivityRow } from './activity-model.ts';
import type { HistoryTone } from './schedule-model.ts';

function ToneIcon({ tone }: { tone: HistoryTone }) {
  if (tone === 'running') return <SpinnerIcon />;
  if (tone === 'succeeded') return <CheckIcon className="wf-state-ic" />;
  if (tone === 'failed') return <WarnIcon />;
  return <MinusIcon />;
}

function RowBody({ row }: { row: ActivityRow }) {
  return (
    <>
      <span className="wf-runs-when">{row.when}</span>
      <span className="wf-runs-how">{row.how}</span>
      <span className="wf-state" data-state={row.tone}>
        <ToneIcon tone={row.tone} />
        {row.state}
      </span>
      {row.note && <span className="wf-runs-note">{row.note}</span>}
      {row.took && <span className="wf-runs-end">{row.took}</span>}
    </>
  );
}

interface ActivityListProps {
  rows: readonly ActivityRow[];
  label: string;
  releasing: boolean;
  onOpenRun: (runId: string) => void;
  onRelease: (holdId: string) => void;
}

export function ActivityList({ rows, label, releasing, onOpenRun, onRelease }: ActivityListProps) {
  return (
    <ul className="wf-runs-list" aria-label={label}>
      {rows.map((row) => {
        const { runId, holdId } = row;
        if (runId !== null) {
          return (
            <li key={row.key}>
              <button
                type="button"
                className="wf-runs-row"
                aria-label={`Open the run from ${row.when}`}
                onClick={() => onOpenRun(runId)}
              >
                <RowBody row={row} />
              </button>
            </li>
          );
        }
        return (
          <li key={row.key} className="wf-runs-row wf-runs-quiet">
            <RowBody row={row} />
            {holdId !== null && (
              <button
                type="button"
                className="btn line sm"
                disabled={releasing}
                onClick={() => onRelease(holdId)}
              >
                Release hold
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
