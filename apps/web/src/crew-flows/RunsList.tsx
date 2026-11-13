import './run-view.css';
import type { ReactNode } from 'react';
import type { WorkflowRun } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { SOURCE_WORDS, costText, latestRun, runElapsed, runWhen } from './run-model.ts';
import { RunState } from './RunState.tsx';
import { useNow, useWorkflowRuns } from './use-workflow-runs.ts';

interface RunRowProps {
  when: string;
  how: string;
  state: ReactNode;
  end: readonly string[];
  label: string;
  onOpen: () => void;
}

export function RunRow({ when, how, state, end, label, onOpen }: RunRowProps) {
  return (
    <li>
      <button type="button" className="wf-runs-row" aria-label={label} onClick={onOpen}>
        <span className="wf-runs-when">{when}</span>
        <span className="wf-runs-how">{how}</span>
        {state}
        <span className="wf-runs-end">
          {end.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </span>
      </button>
    </li>
  );
}

interface RunsListProps {
  workflowId: string;
  onOpen: (run: WorkflowRun) => void;
}

export function RunsList({ workflowId, onOpen }: RunsListProps) {
  const runs = useWorkflowRuns(workflowId);
  const shown = (runs.data ?? []).filter((run) => run.kind === 'run');
  const now = useNow(shown.some((run) => run.status === 'running'));
  return (
    <section className="wf-runs" aria-label="Runs" aria-busy={runs.isPending || undefined}>
      <h3>Runs</h3>
      {runs.error && (
        <p className="wf-problem" role="alert">
          <WarnIcon />
          <span>
            <b>Couldn’t load the runs</b> · {runs.error.message}
          </span>
        </p>
      )}
      {runs.data && shown.length === 0 && (
        <p className="wf-hint">Not run yet. Runs show here, newest first.</p>
      )}
      {shown.length > 0 && (
        <ul className="wf-runs-list">
          {shown.map((run) => {
            const cost = costText(run);
            return (
              <RunRow
                key={run.id}
                when={runWhen(run)}
                how={SOURCE_WORDS[run.source]}
                state={<RunState status={run.status} />}
                end={[runElapsed(run, now), ...(cost ? [cost] : [])]}
                label={`Open the run from ${runWhen(run)}`}
                onOpen={() => onOpen(run)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function LastRun({ workflowId, name, onOpen }: RunsListProps & { name: string }) {
  const runs = useWorkflowRuns(workflowId);
  if (!runs.data) return null;
  const last = latestRun(runs.data);
  if (!last) return <span className="wf-hint">Not run yet</span>;
  return (
    <button
      type="button"
      className="wf-last-run"
      aria-label={`Open the last run of ${name}`}
      onClick={() => onOpen(last)}
    >
      <RunState status={last.status} />
      <span>{relativeTime(last.startedAt)}</span>
    </button>
  );
}
