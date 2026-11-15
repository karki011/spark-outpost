import type { WorkflowTriggersView } from '@spark-outpost/contracts';
import { hourCycle } from '../desktop/hour-cycle.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { useMinuteClock } from '../ui/use-minute-clock.ts';
import { ToneIcon } from './ScheduleHistory.tsx';
import { eventRow, holdLine } from './triggers-model.ts';
import { useReleaseHold } from './use-triggers.ts';

interface TriggerActivityProps {
  workflowId: string;
  view: WorkflowTriggersView;
}

export function TriggerActivity({ workflowId, view }: TriggerActivityProps) {
  const now = new Date(useMinuteClock());
  const cycle = hourCycle();
  const release = useReleaseHold(workflowId);
  const open = view.holds.filter((hold) => hold.state === 'open');
  const rows = view.events.map((event) => eventRow(event, now, cycle));
  return (
    <div className="wf-sched-runs">
      <h3 id={`wf-holds-${workflowId}`}>Held publishes</h3>
      <p className="wf-hint">
        Releasing a hold never pushes. The chat publishes on its next Full auto turn, or when you
        ask for it in a message.
      </p>
      {release.error && (
        <p className="wf-problem wf-error" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t release</b> · {release.error.message}
          </span>
        </p>
      )}
      {open.length === 0 && <p className="wf-hint">Nothing is held.</p>}
      <ul aria-labelledby={`wf-holds-${workflowId}`}>
        {open.map((hold) => (
          <li key={hold.id} className="wf-sched-run">
            <b>{hold.chatTitle || 'Untitled chat'}</b>
            <span className="wf-state" data-state="failed">
              <WarnIcon />
              Held
            </span>
            <span className="wf-sched-note">{holdLine(hold)}</span>
            <button
              type="button"
              className="btn line sm"
              disabled={release.isPending}
              onClick={() => release.mutate(hold.id)}
            >
              Release hold
            </button>
          </li>
        ))}
      </ul>

      <h3 id={`wf-events-${workflowId}`}>Recent triggers</h3>
      {rows.length === 0 && <p className="wf-hint">Nothing has triggered this workflow yet.</p>}
      <ul aria-labelledby={`wf-events-${workflowId}`}>
        {rows.map((row) => (
          <li key={row.key} className="wf-sched-run">
            <b>{row.when}</b>
            <span>{row.what}</span>
            <span className="wf-state" data-state={row.tone}>
              <ToneIcon tone={row.tone} />
              {row.state}
            </span>
            <span className="wf-sched-note">
              {row.chat}
              {row.note ? ` · ${row.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
