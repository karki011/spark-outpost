import { useQuery } from '@tanstack/react-query';
import type { FileView } from '@spark-outpost/contracts';
import { islandApi, islandKeys } from './island-api.ts';

export function useFileView(
  conversationId: string,
  step: string | null,
  runIds: readonly string[],
): FileView | null {
  const query = useQuery({
    queryKey: islandKeys.fileView(conversationId, step ?? ''),
    queryFn: () => islandApi.fileView(conversationId),
    enabled: step !== null,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const view = step === null ? null : (query.data?.view ?? null);
  return view && runIds.includes(view.runId) ? view : null;
}
