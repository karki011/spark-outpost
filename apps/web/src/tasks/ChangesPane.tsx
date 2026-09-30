import './changes-pane.css';
import { useQuery } from '@tanstack/react-query';
import { isTerminalRunStatus, type RunFileChanges, type TaskRun } from '@spark-outpost/contracts';
import { changeTotals, filesLabel } from '../chat/changes/change-rules.ts';
import { Counts, FileChangeList } from '../chat/changes/FileChangeList.tsx';
import { CoreImpactNote } from '../map/CoreImpactNote.tsx';
import { ShipControl } from '../ship/ShipControl.tsx';
import { crewNames } from './CrewPane.tsx';
import { taskApi, taskKeys } from './task-api.ts';

function RunGroup({ taskId, run, name }: { taskId: string; run: RunFileChanges; name: string }) {
  const totals = changeTotals(run.files);
  return (
    <section className="chg" aria-label={`${name} · ${filesLabel(run.files.length)}`}>
      <h4>
        <span>
          {name} · {filesLabel(run.files.length)}
        </span>
        <Counts added={totals.added} removed={totals.removed} />
        {run.revertedAt && <span className="chg-rev">reverted</span>}
      </h4>
      <FileChangeList
        taskId={taskId}
        entries={run.files.map((file) => ({ runId: run.runId, file }))}
      />
    </section>
  );
}

interface ChangesPaneProps {
  taskId: string;
  conversationId: string;
  runs: readonly TaskRun[];
}

export function ChangesPane({ taskId, conversationId, runs }: ChangesPaneProps) {
  const changes = useQuery({
    queryKey: taskKeys.changes(taskId),
    queryFn: () => taskApi.changes(taskId),
  });
  const names = new Map(crewNames(runs).map((name, index) => [runs[index]!.id, name]));
  const groups = changes.data?.runs ?? [];
  const totals = changeTotals(groups.flatMap((run) => run.files));
  const settled = runs.length > 0 && runs.every((run) => isTerminalRunStatus(run.status));
  return (
    <div className="wsec">
      <div className="wsec-h">
        <h3>What changed</h3>
        {totals.files > 0 && (
          <span className="r chg-total">
            {filesLabel(totals.files)} <Counts added={totals.added} removed={totals.removed} />
          </span>
        )}
      </div>
      {groups.length > 0 && <CoreImpactNote impact={changes.data?.core} />}
      {changes.isPending && <p className="wnote first">Loading…</p>}
      {changes.isError && <p className="wnote first bad">{changes.error.message}</p>}
      {changes.data && groups.length === 0 && (
        <p className="wnote first">No file changes in this task yet.</p>
      )}
      {groups.map((run) => (
        <RunGroup
          key={run.runId}
          taskId={taskId}
          run={run}
          name={
            run.name ? `${run.name}${run.copy ? '’s copy' : ''}` : (names.get(run.runId) ?? 'Run')
          }
        />
      ))}
      {groups.length > 0 && settled && (
        <ShipControl taskId={taskId} conversationId={conversationId} />
      )}
      {groups.length > 0 && (
        <p className="wnote">
          Each run shows what changed from its start until the next run, or until now for the last
          one.
        </p>
      )}
    </div>
  );
}
