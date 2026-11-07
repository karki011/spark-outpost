import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Approval } from '@spark-outpost/contracts';
import { queryKeys } from '../../api/client.ts';
import { projectKeys } from '../../api/projects.ts';

function linked(approval: Approval): boolean {
  const action = approval.payload.sparkAction?.action;
  return (
    (action === 'link_repo' || action === 'clone_repo') &&
    approval.payload.sparkResult?.state === 'done'
  );
}

export function useLinkedRepoRefresh(approval: Approval): void {
  const queryClient = useQueryClient();
  const done = linked(approval);
  const wasDone = useRef(done);
  useEffect(() => {
    if (!done || wasDone.current) return;
    wasDone.current = true;
    void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.conversations });
  }, [done, queryClient]);
}
