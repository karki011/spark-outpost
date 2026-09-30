import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TaskChanges, TaskOverview } from '@spark-outpost/contracts';
import { taskApi, taskKeys } from '../../tasks/task-api.ts';
import { CoreImpactNote } from '../../map/CoreImpactNote.tsx';
import { useViewChanges } from '../../tasks/view-changes.ts';
import { changeTotals, filesLabel } from './change-rules.ts';
import { Counts, FileChangeList, type FileEntry } from './FileChangeList.tsx';

const FIRST_FILES = 6;

export function taskForRuns(
  tasks: readonly TaskOverview[],
  runIds: readonly string[],
): TaskOverview | null {
  return tasks.find((task) => runIds.some((runId) => task.runIds.includes(runId))) ?? null;
}

export function fileEntries(
  changes: TaskChanges | undefined,
  runIds: readonly string[],
): FileEntry[] {
  return (changes?.runs ?? [])
    .filter((run) => runIds.includes(run.runId) && !run.revertedAt)
    .flatMap((run) => run.files.map((file) => ({ runId: run.runId, file })));
}

interface FilesChangedProps {
  taskId: string;
  runIds: readonly string[];
  listed?: readonly string[];
}

export function FilesChanged({ taskId, runIds, listed = runIds }: FilesChangedProps) {
  const viewChanges = useViewChanges();
  const [all, setAll] = useState(false);
  const changes = useQuery({
    queryKey: taskKeys.changes(taskId),
    queryFn: () => taskApi.changes(taskId),
  });
  const entries = fileEntries(changes.data, runIds);
  if (entries.length === 0) return null;
  const totals = changeTotals(entries.map((entry) => entry.file));
  const listable = entries.filter((entry) => listed.includes(entry.runId));
  const shown = all ? listable : listable.slice(0, FIRST_FILES);
  const list = listable.length > 0;
  const label = `${filesLabel(totals.files)} changed`;
  return (
    <section className={list ? 'fchg' : 'fchg bare'} aria-label={`Files changed: ${label}`}>
      <div className="fchg-h">
        <b>{label}</b>
        <Counts added={totals.added} removed={totals.removed} />
        {viewChanges && (
          <button type="button" className="fchg-review" onClick={() => viewChanges(taskId)}>
            Review all changes
          </button>
        )}
      </div>
      <CoreImpactNote impact={changes.data?.core} />
      {list && <FileChangeList taskId={taskId} entries={shown} />}
      {list && listable.length > shown.length && (
        <button type="button" className="fchg-more" onClick={() => setAll(true)}>
          Show {filesLabel(listable.length - shown.length)} more
        </button>
      )}
    </section>
  );
}
