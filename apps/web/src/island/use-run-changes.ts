import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChangeEntry } from '@spark-outpost/contracts';
import { diffApi, diffKeys } from '../diff/diff-api.ts';

const NO_ENTRIES: ChangeEntry[] = [];

export interface RunChanges {
  version: string | undefined;
  entries: readonly ChangeEntry[];
}

export function useRunChanges(
  taskId: string | null,
  runIds: readonly string[],
  wanted: boolean,
): RunChanges {
  const enabled = wanted && taskId !== null && runIds.length > 0;
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled,
  });
  const version = summary.data?.version;
  const params = { version, q: '', runs: runIds, page: 0 };
  const page = useQuery({
    queryKey: diffKeys.page(taskId ?? '', params),
    queryFn: () => diffApi.page(taskId ?? '', params),
    enabled: enabled && (summary.data?.files ?? 0) > 0,
    placeholderData: keepPreviousData,
  });
  return { version, entries: page.data?.files ?? NO_ENTRIES };
}
