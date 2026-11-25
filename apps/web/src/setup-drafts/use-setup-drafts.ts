import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SetupDraft, SetupFields, SetupTarget } from '@spark-outpost/contracts';
import { setupDraftsApi, setupDraftsKey } from './setup-drafts-api.ts';

export interface PreparedSetup {
  fields: SetupFields | null;
  clear: () => void;
}

export function useSetupDrafts(): {
  drafts: readonly SetupDraft[];
  clear: (target: SetupTarget) => void;
} {
  const queryClient = useQueryClient();
  const drafts = useQuery({ queryKey: setupDraftsKey, queryFn: setupDraftsApi.list });
  const clear = useMutation({
    mutationFn: setupDraftsApi.clear,
    onSuccess: (next) => queryClient.setQueryData(setupDraftsKey, next),
  });
  return { drafts: drafts.data?.drafts ?? [], clear: clear.mutate };
}

export function usePreparedSetup(target: SetupTarget | null): PreparedSetup {
  const { drafts, clear } = useSetupDrafts();
  const draft = target ? drafts.find((entry) => entry.target === target) : undefined;
  return {
    fields: draft?.fields ?? null,
    clear: () => {
      if (draft) clear(draft.target);
    },
  };
}
