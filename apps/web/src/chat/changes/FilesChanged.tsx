import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { RevertedFile, TaskOverview } from '@spark-outpost/contracts';
import { RestoreIcon } from '../../ui/icons.tsx';
import { CoreImpactNote } from '../../map/CoreImpactNote.tsx';
import { useViewChanges } from '../../tasks/view-changes.ts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import { filesLabel, runTotals } from './change-rules.ts';
import { Counts, FileChangeList } from './FileChangeList.tsx';

const FIRST_FILES = 6;

export function taskForRuns(
  tasks: readonly TaskOverview[],
  runIds: readonly string[],
): TaskOverview | null {
  return tasks.find((task) => runIds.some((runId) => task.runIds.includes(runId))) ?? null;
}

function RevertedFiles({ files }: { files: readonly RevertedFile[] }) {
  return (
    <ul className="fchg-reverted" aria-label="Reverted files">
      {files.map((file) => (
        <li key={file.path}>
          <RestoreIcon />
          Reverted <code>{file.path}</code>
        </li>
      ))}
    </ul>
  );
}

interface FilesChangedProps {
  taskId: string;
  runIds: readonly string[];
  listed?: readonly string[];
}

export function FilesChanged({ taskId, runIds, listed = runIds }: FilesChangedProps) {
  const viewChanges = useViewChanges();
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId),
    queryFn: () => diffApi.summary(taskId),
  });
  const live = (summary.data?.runs ?? []).filter(
    (run) => runIds.includes(run.runId) && !run.revertedAt,
  );
  const reverted = live.flatMap((run) => run.reverted ?? []);
  const listable = live
    .filter((run) => run.files > 0 && listed.includes(run.runId))
    .map((run) => run.runId);
  const params = { version: summary.data?.version, q: '', runs: listable, page: 0 };
  const page = useQuery({
    queryKey: diffKeys.page(taskId, params),
    queryFn: () => diffApi.page(taskId, params),
    enabled: listable.length > 0,
    placeholderData: keepPreviousData,
  });
  if (live.length === 0) return null;
  const { files, added, removed } = runTotals(live);
  if (files === 0) {
    return (
      <section className="fchg bare" aria-label="Reverted files">
        <RevertedFiles files={reverted} />
      </section>
    );
  }
  const shown = page.data?.files.slice(0, FIRST_FILES) ?? [];
  const more = (page.data?.total ?? 0) - shown.length;
  const list = listable.length > 0;
  const label = `${filesLabel(files)} changed`;
  return (
    <section className={list ? 'fchg' : 'fchg bare'} aria-label={`Files changed: ${label}`}>
      <div className="fchg-h">
        <b>{label}</b>
        <Counts added={added} removed={removed} />
        {viewChanges && (
          <button type="button" className="fchg-review" onClick={() => viewChanges(taskId)}>
            Review all changes
          </button>
        )}
      </div>
      <CoreImpactNote impact={summary.data?.core} />
      {list && <FileChangeList taskId={taskId} entries={shown} />}
      {reverted.length > 0 && <RevertedFiles files={reverted} />}
      {more > 0 && viewChanges && (
        <button type="button" className="fchg-more" onClick={() => viewChanges(taskId)}>
          Show {filesLabel(more)} more
        </button>
      )}
    </section>
  );
}
