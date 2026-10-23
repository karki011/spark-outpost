import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import { useViewChanges } from '../../tasks/view-changes.ts';
import { runTotals } from '../changes/change-rules.ts';
import { baseName } from './turn-rows.ts';

export interface TurnChanges {
  files: number;
  added: number;
  removed: number;
  entry(path: string): ChangeEntry | null;
  open: ((file?: ChangeEntry) => void) | null;
}

function sameFile(stepPath: string, filePath: string): boolean {
  return stepPath === filePath || stepPath.endsWith(`/${filePath}`);
}

export function changeEntry(files: readonly ChangeEntry[], path: string): ChangeEntry | null {
  if (path.includes('/')) {
    const matches = files.filter((file) => sameFile(path, file.path));
    return matches.sort((left, right) => right.path.length - left.path.length)[0] ?? null;
  }
  const named = files.filter((file) => baseName(file.path) === path);
  return named.length === 1 ? named[0]! : null;
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
  const files = page.data?.files ?? [];
  return {
    ...runTotals(live),
    entry: (path) => changeEntry(files, path),
    open: viewChanges ? (file) => viewChanges(taskId, file) : null,
  };
}
