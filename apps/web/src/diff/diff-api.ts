import {
  changeDiffSchema,
  changePageSchema,
  changeSummarySchema,
  type ChangeDiff,
  type ChangePage,
  type ChangeSummary,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';
import { taskKeys } from '../tasks/task-api.ts';

export const FILE_PAGE_SIZE = 200;

export interface PageParams {
  version: string | undefined;
  q: string;
  runs: readonly string[] | null;
  page: number;
}

export interface DiffParams {
  version: string | undefined;
  runId: string;
  path: string;
  lines: number | null;
}

export const diffKeys = {
  summary: (taskId: string) => [...taskKeys.changes(taskId), 'summary'] as const,
  page: (taskId: string, params: PageParams) =>
    [
      ...taskKeys.changes(taskId),
      'files',
      params.q,
      params.runs?.join(',') ?? '',
      params.page,
    ] as const,
  file: (taskId: string, runId: string, path: string, lines: number | null) =>
    [...taskKeys.changes(taskId), 'diff', runId, path, lines] as const,
};

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const diffApi = {
  summary: (taskId: string): Promise<ChangeSummary> =>
    request(changeSummarySchema, `/tasks/${taskId}/changes/summary`),
  page: (taskId: string, params: PageParams): Promise<ChangePage> =>
    request(
      changePageSchema,
      `/tasks/${taskId}/changes/files?${query({
        version: params.version,
        offset: params.page * FILE_PAGE_SIZE,
        limit: FILE_PAGE_SIZE,
        q: params.q,
        runs: params.runs?.join(','),
      })}`,
    ),
  file: (taskId: string, params: DiffParams): Promise<ChangeDiff> =>
    request(
      changeDiffSchema,
      `/tasks/${taskId}/changes/diff?${query({
        version: params.version,
        runId: params.runId,
        path: params.path,
        lines: params.lines ?? undefined,
      })}`,
    ),
};
