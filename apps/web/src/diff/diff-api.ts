import {
  changeDiffSchema,
  changePageSchema,
  changeSummarySchema,
  fileRevertCheckSchema,
  fileRevertResponseSchema,
  type ChangeDiff,
  type ChangePage,
  type ChangeSummary,
  type FileRevertCheck,
  type FileRevertQuery,
  type FileRevertResponse,
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

const SUMMARIES = [...taskKeys.all, 'change-summaries'] as const;

export const diffKeys = {
  summaries: SUMMARIES,
  summary: (taskId: string) => [...SUMMARIES, taskId] as const,
  page: (taskId: string, params: PageParams) =>
    [
      ...taskKeys.changes(taskId),
      'files',
      params.version ?? '',
      params.q,
      params.runs?.join(',') ?? '',
      params.page,
    ] as const,
  file: (taskId: string, params: DiffParams) =>
    [
      ...taskKeys.changes(taskId),
      'diff',
      params.version ?? '',
      params.runId,
      params.path,
      params.lines,
    ] as const,
  revertCheck: (taskId: string, params: FileRevertQuery) =>
    [...taskKeys.changes(taskId), 'revert-file', params.runId, params.path] as const,
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
  revertCheck: (taskId: string, params: FileRevertQuery): Promise<FileRevertCheck> =>
    request(fileRevertCheckSchema, `/tasks/${taskId}/changes/revert-file?${query({ ...params })}`),
  revertFile: (taskId: string, params: FileRevertQuery): Promise<FileRevertResponse> =>
    request(fileRevertResponseSchema, `/tasks/${taskId}/changes/revert-file`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
};
