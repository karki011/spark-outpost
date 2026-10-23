import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import { useViewChanges } from '../../tasks/view-changes.ts';
import { runTotals } from '../changes/change-rules.ts';

export interface TurnChanges {
  files: number;
  added: number;
  removed: number;
  entry(name: string): ChangeEntry | null;
  open: ((file?: ChangeEntry) => void) | null;
}

function baseName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

export function useTurnChanges(
  taskId: string | null,
  runIds: readonly string[],
): TurnChanges | null {
  const viewChanges = useViewChanges();
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId!),
    enabled: taskId !== null,
  });
  const live = (summary.data?.runs ?? []).filter(
    (run) => runIds.includes(run.runId) && !run.revertedAt && run.files > 0,
  );
  const listed = live.map((run) => run.runId);
  const params = { version: summary.data?.version, q: '', runs: listed, page: 0 };
  const page = useQuery({
    queryKey: diffKeys.page(taskId ?? '', params),
    queryFn: () => diffApi.page(taskId!, params),
    enabled: taskId !== null && listed.length > 0,
    placeholderData: keepPreviousData,
  });
  if (!taskId || live.length === 0) return null;
  const byName = new Map((page.data?.files ?? []).map((file) => [baseName(file.path), file]));
  return {
    ...runTotals(live),
    entry: (name) => byName.get(name) ?? null,
    open: viewChanges ? (file) => viewChanges(taskId, file) : null,
  };
}
