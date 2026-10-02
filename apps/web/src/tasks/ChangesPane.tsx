import './changes-pane.css';
import '../diff/diff-frame.css';
import { useQuery } from '@tanstack/react-query';
import { isTerminalRunStatus, type ChangeRunSummary, type TaskRun } from '@spark-outpost/contracts';
import { filesLabel } from '../chat/changes/change-rules.ts';
import { Counts, DiffStat, FileChangeList } from '../chat/changes/FileChangeList.tsx';
import { diffApi, diffKeys } from '../diff/diff-api.ts';
import { CoreImpactNote } from '../map/CoreImpactNote.tsx';
import { ShipControl } from '../ship/ShipControl.tsx';
import { crewNames } from './CrewPane.tsx';
import { useViewChanges } from './view-changes.ts';

const SKELETON_ROWS = ['64%', '48%', '72%'];

function runName(run: ChangeRunSummary, names: ReadonlyMap<string, string>): string {
  if (run.name) return `${run.name}${run.copy ? '’s copy' : ''}`;
  return names.get(run.runId) ?? 'Run';
}

function RunRow({ run, name }: { run: ChangeRunSummary; name: string }) {
  return (
    <li className={run.revertedAt ? 'chg-run reverted' : 'chg-run'}>
      <span className="chg-run-name">
        {name} · {filesLabel(run.files)}
      </span>
      {run.revertedAt ? (
        <span className="chg-rev">reverted</span>
      ) : (
        <Counts added={run.added} removed={run.removed} />
      )}
    </li>
  );
}

function SummarySkeleton() {
  return (
    <div className="chg-skel" aria-hidden="true">
      {SKELETON_ROWS.map((width) => (
        <span key={width} className="dd-skel" style={{ width }} />
      ))}
    </div>
  );
}

interface ChangesPaneProps {
  taskId: string;
  conversationId: string;
  runs: readonly TaskRun[];
}

export function ChangesPane({ taskId, conversationId, runs }: ChangesPaneProps) {
  const viewChanges = useViewChanges();
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId),
    queryFn: () => diffApi.summary(taskId),
  });
  const names = new Map(crewNames(runs).map((name, index) => [runs[index]!.id, name]));
  const data = summary.data;
  const groups = data?.runs ?? [];
  const settled = runs.length > 0 && runs.every((run) => isTerminalRunStatus(run.status));
  return (
    <div className="wsec" aria-busy={summary.isPending || undefined}>
      <div className="wsec-h">
        <h3>What changed</h3>
        {data && data.files > 0 && (
          <span className="r chg-total">
            {filesLabel(data.files)} <Counts added={data.added} removed={data.removed} />
            <DiffStat added={data.added} removed={data.removed} />
          </span>
        )}
      </div>
      {summary.isPending && <SummarySkeleton />}
      {summary.isError && <p className="wnote first bad">{summary.error.message}</p>}
      {data && groups.length === 0 && (
        <p className="wnote first">No file changes in this task yet.</p>
      )}
      {groups.length > 0 && <CoreImpactNote impact={data?.core} />}
      {data && data.files > 0 && viewChanges && (
        <button type="button" className="btn sm line chg-open" onClick={() => viewChanges(taskId)}>
          Open diff
        </button>
      )}
      {data && data.top.length > 0 && (
        <section className="chg" aria-label="Most changed files">
          <h4>Most changed</h4>
          <FileChangeList taskId={taskId} entries={data.top} />
        </section>
      )}
      {groups.length > 0 && (
        <section className="chg" aria-label="By run">
          <h4>By run</h4>
          <ul className="chg-runs">
            {groups.map((run) => (
              <RunRow key={run.runId} run={run} name={runName(run, names)} />
            ))}
          </ul>
        </section>
      )}
      {groups.length > 0 && settled && (
        <ShipControl taskId={taskId} conversationId={conversationId} />
      )}
      {groups.length > 0 && (
        <p className="wnote">
          Each run counts what changed from its start until the next run, or until now for the last
          one.
        </p>
      )}
    </div>
  );
}
