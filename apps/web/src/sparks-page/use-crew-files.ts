import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CrewFile, SaveCrewFile } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';
import { crewFileKeys, crewFilesApi } from './crew-files-api.ts';

const FOLDER_FRESH_MS = 30_000;

export function useSparkFolder(sparkId: string, enabled = true) {
  return useQuery({
    queryKey: crewFileKeys.folder(sparkId),
    queryFn: () => crewFilesApi.folder(sparkId),
    staleTime: FOLDER_FRESH_MS,
    enabled,
  });
}

export function useSkillCounts(sparkIds: readonly string[], enabled: boolean) {
  const folders = useQueries({
    queries: sparkIds.map((sparkId) => ({
      queryKey: crewFileKeys.folder(sparkId),
      queryFn: () => crewFilesApi.folder(sparkId),
      staleTime: FOLDER_FRESH_MS,
      enabled,
    })),
  });
  return new Map(sparkIds.map((sparkId, index) => [sparkId, folders[index]?.data?.skills.length]));
}

export function useCrewFile(sparkId: string, path: string, exists: boolean) {
  return useQuery({
    queryKey: crewFileKeys.file(sparkId, path),
    queryFn: () => crewFilesApi.read(sparkId, path),
    enabled: exists,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export async function latestHash(sparkId: string, path: string): Promise<string | null> {
  try {
    return (await crewFilesApi.read(sparkId, path)).hash;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function useSaveCrewFile(sparkId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: SaveCrewFile) => crewFilesApi.save(sparkId, file),
    onSuccess: async (saved: CrewFile) => {
      client.setQueryData(crewFileKeys.file(sparkId, saved.path), saved);
      await client.invalidateQueries({ queryKey: crewFileKeys.folder(sparkId) });
    },
  });
}

export function useRemoveCrewFile(sparkId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => crewFilesApi.remove(sparkId, path),
    onSuccess: () => client.invalidateQueries({ queryKey: crewFileKeys.folder(sparkId) }),
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The server could not be reached.';
}

export function useRenameCrewFile(sparkId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ from, to, text }: { from: string; to: string; text: string }) => {
      const saved = await crewFilesApi
        .save(sparkId, { path: to, text, baseHash: null })
        .catch((error: unknown) => {
          throw new Error(`Not renamed. ${reasonOf(error)}`);
        });
      await crewFilesApi.remove(sparkId, from).catch((error: unknown) => {
        throw new Error(`Saved as ${to}, but ${from} is still there. ${reasonOf(error)}`);
      });
      return saved;
    },
    onSettled: () => client.invalidateQueries({ queryKey: crewFileKeys.folder(sparkId) }),
  });
}
