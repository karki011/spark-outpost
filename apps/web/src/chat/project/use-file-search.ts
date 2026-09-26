import { useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import type { Project, ProjectFile } from '@spark-outpost/contracts';
import { projectKeys, projectsApi } from '../../api/projects.ts';
import { useDebouncedValue } from '../../ui/use-debounced-value.ts';
import { interleave } from './repo-list.ts';

const SEARCH_DELAY_MS = 150;

export interface RepoFile extends ProjectFile {
  projectId: string;
  repo: string;
}

export function repoFileKey(file: Pick<RepoFile, 'projectId' | 'path'>): string {
  return `${file.projectId}:${file.path}`;
}

export interface FileSearch {
  files: RepoFile[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  active: number;
  setActive: (index: number) => void;
  handleKey: (event: KeyboardEvent<HTMLElement>, onPick: (file: RepoFile) => void) => boolean;
}

export function useFileSearch(repos: readonly Project[], query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query.trim(), SEARCH_DELAY_MS);
  const [selection, setSelection] = useState({ query: debounced, index: 0 });
  const results = useQueries({
    queries: repos.map((repo) => ({
      queryKey: projectKeys.files(repo.id, debounced),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        projectsApi.files(repo.id, debounced, signal),
      enabled,
      placeholderData: keepPreviousData,
    })),
  });
  const files = interleave(
    results.map((result, index) => {
      const repo = repos[index]!;
      return (result.data?.files ?? []).map((file): RepoFile => ({
        ...file,
        projectId: repo.id,
        repo: repo.name,
      }));
    }),
  );
  const failed = results.find((result) => result.isError);
  const index = selection.query === debounced ? selection.index : 0;
  const active = Math.min(index, Math.max(0, files.length - 1));
  const setActive = (next: number) => setSelection({ query: debounced, index: next });

  const handleKey = (event: KeyboardEvent<HTMLElement>, onPick: (file: RepoFile) => void) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (files.length === 0) return true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + files.length) % files.length);
      return true;
    }
    const file = files[active];
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && file) {
      event.preventDefault();
      onPick(file);
      return true;
    }
    return false;
  };

  return {
    files,
    truncated: results.some((result) => result.data?.truncated),
    loading: results.some((result) => result.isFetching) || debounced !== query.trim(),
    error: failed?.error?.message ?? null,
    active,
    setActive,
    handleKey,
  } satisfies FileSearch;
}
