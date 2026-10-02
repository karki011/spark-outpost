import { useQuery } from '@tanstack/react-query';
import type { TeammateView } from '@spark-outpost/contracts';
import { teammateKeys, teammatesApi } from './teammates-api.ts';
import { useTeammateUi } from './teammate-store.ts';

const NONE: TeammateView[] = [];

export function useTeammates() {
  const list = useQuery({ queryKey: teammateKeys.all, queryFn: teammatesApi.list });
  const { deleting } = useTeammateUi();
  const teammates = (list.data?.teammates ?? NONE).filter(
    (teammate) => teammate.id !== deleting?.id,
  );
  return {
    loading: list.isPending,
    error: list.error,
    teammates,
    starters: list.data?.starters ?? [],
  };
}
