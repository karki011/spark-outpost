import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  islandRequestSchema,
  islandRequestsSchema,
  type IslandRequest,
  type IslandRequestKind,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const islandRequestsKey = ['island-requests'] as const;

export const islandRequestsApi = {
  list: () => request(islandRequestsSchema, '/island/requests'),
  claim: (id: string) =>
    request(islandRequestSchema, `/island/requests/${id}/claim`, { method: 'POST', body: '{}' }),
};

export type IslandRequestHandler = (request: IslandRequest) => (() => void) | null;

export function useIslandRequests(
  kinds: readonly IslandRequestKind[],
  handle: IslandRequestHandler,
): void {
  const listed = useQuery({ queryKey: islandRequestsKey, queryFn: islandRequestsApi.list });
  const taking = useRef<Set<string>>(new Set());
  const latest = useRef(handle);
  useEffect(() => {
    latest.current = handle;
  });
  const requests = listed.data?.requests;
  useEffect(() => {
    for (const pending of requests ?? []) {
      if (!kinds.includes(pending.kind) || taking.current.has(pending.id)) continue;
      const apply = latest.current(pending);
      if (!apply) continue;
      taking.current.add(pending.id);
      void islandRequestsApi
        .claim(pending.id)
        .then(() => apply())
        .catch(() => undefined);
    }
  });
}
