import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecapRefineRequest, RecapState } from '@spark-outpost/contracts';
import { homeApi, homeKeys } from '../home-api.ts';
import { lastRefineError, recapView, refining } from './recap-model.ts';

function newerRecap(state: RecapState | undefined, since: number): boolean {
  const created = state?.recap?.createdAt;
  return created !== undefined && Date.parse(created) > since;
}

export function useRecap() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: homeKeys.recap, queryFn: homeApi.recap });
  const store = (state: RecapState) => queryClient.setQueryData(homeKeys.recap, state);
  const write = useMutation({ mutationFn: homeApi.requestRecap, onSuccess: store });
  const refine = useMutation({
    mutationFn: ({ id, request }: { id: string; request: RecapRefineRequest }) =>
      homeApi.refineRecap(id, request),
    onSuccess: store,
  });
  const state = query.data;
  const refines = state?.refines ?? [];
  return {
    state,
    view: recapView(state),
    recap: state?.recap ?? null,
    refines,
    writing: write.isPending || state?.recap?.status === 'running',
    writeError: write.isError && !newerRecap(state, write.submittedAt) ? write.error.message : null,
    write: () => write.mutate(),
    rewriting: refine.isPending || refining(refines) !== null,
    refineError: refine.isError ? refine.error.message : lastRefineError(refines),
    refine: (id: string, request: RecapRefineRequest) => refine.mutate({ id, request }),
  };
}

export type Recap = ReturnType<typeof useRecap>;
