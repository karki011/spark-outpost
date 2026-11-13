import { hourCycle } from '../desktop/hour-cycle.ts';
import {
  CheckIcon,
  ClockIcon,
  MinusIcon,
  ResumeIcon,
  SpinnerIcon,
  WarnIcon,
} from '../ui/icons.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { historyRows, type HistoryRow, type HistoryTone } from './schedule-model.ts';
import { useScheduleHistory } from './use-schedule.ts';

function ToneIcon({ tone }: { tone: HistoryTone }) {
  if (tone === 'running') return <SpinnerIcon />;
  if (tone === 'succeeded') return <CheckIcon className="wf-state-ic" />;
  if (tone === 'failed') return <WarnIcon />;
  return <MinusIcon />;
}

function Row({ row }: { row: HistoryRow }) {
  return (
    <li className="wf-sched-run">
      <b>{row.when}</b>
      <span className="wf-state">
        {row.scheduled ? <ClockIcon /> : <ResumeIcon />}
        {row.how}
      </span>
      <span className="wf-state" data-state={row.tone}>
        <ToneIcon tone={row.tone} />
        {row.state}
      </span>
      <span className="wf-sched-note">{row.note}</span>
      <span className="wf-hint">{row.took}</span>
    </li>
  );
}

export function ScheduleHistory({ workflowId }: { workflowId: string }) {
  const history = useScheduleHistory(workflowId);
  const now = new Date(useMinuteClock());
  const rows = history.data
    ? historyRows(history.data.runs, history.data.slots, now, hourCycle())
    : [];
  return (
    <div className="wf-sched-runs" aria-busy={history.isPending || undefined}>
      <h3 id={`wf-sched-runs-${workflowId}`}>Recent runs</h3>
      <p className="wf-hint">
        Scheduled runs show in Updates when they finish and never count as needing you. A scheduled
        run is not your message: it can’t ask for a push, a pull request or a Spark action.
      </p>
      {history.error && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t load the runs</b> · {history.error.message}
          </span>
        </p>
      )}
      {history.data && rows.length === 0 && <p className="wf-hint">No runs yet.</p>}
      <ul aria-labelledby={`wf-sched-runs-${workflowId}`}>
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </ul>
    </div>
  );
}
