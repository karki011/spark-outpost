import {
  keepPreviousData,
  useQueries,
  useQuery,
  type Query,
  type QueryKey,
} from '@tanstack/react-query';
import type { ChangeEntry, ChangePage } from '@spark-outpost/contracts';
import { diffApi, diffKeys, FILE_PAGE_SIZE, type PageParams } from '../diff-api.ts';

const PAGE_STALE_MS = 30_000;

function params(version: string | undefined, q: string, page: number): PageParams {
  return { version, q, runs: null, page };
}

function samePage(key: QueryKey, request: PageParams): boolean {
  return key.at(-3) === request.q && key.at(-1) === request.page;
}

export function useFirstPage(taskId: string, version: string | undefined, q: string) {
  const first = params(version, q, 0);
  return useQuery({
    queryKey: diffKeys.page(taskId, first),
    queryFn: () => diffApi.page(taskId, first),
    placeholderData: keepPreviousData,
    staleTime: PAGE_STALE_MS,
  });
}

export function useFilePages(
  taskId: string,
  version: string | undefined,
  q: string,
  first: ChangePage | undefined,
  pages: readonly number[],
): (index: number) => ChangeEntry | null {
  const later = pages.filter((page) => page > 0);
  const results = useQueries({
    queries: later.map((page) => {
      const request = params(version, q, page);
      return {
        queryKey: diffKeys.page(taskId, request),
        queryFn: () => diffApi.page(taskId, request),
        staleTime: PAGE_STALE_MS,
        placeholderData: (previous: ChangePage | undefined, previousQuery?: Query<ChangePage>) =>
          previousQuery && samePage(previousQuery.queryKey, request) ? previous : undefined,
        enabled: first !== undefined,
      };
    }),
  });
  const loaded = new Map<number, ChangePage>();
  if (first) loaded.set(0, first);
  later.forEach((page, index) => {
    const data = results[index]?.data;
    if (data) loaded.set(page, data);
  });
  return (index) => {
    const page = loaded.get(Math.floor(index / FILE_PAGE_SIZE));
    return page?.files[index - page.offset] ?? null;
  };
}
