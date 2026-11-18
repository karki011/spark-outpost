import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GithubReviewSettings } from '@spark-outpost/contracts';
import { useWorkflows } from '../crew-flows/use-workflows.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { useTeammates } from '../teammates/use-teammates.ts';
import {
  applyChange,
  toUpdate,
  type AutoReviewChange,
  type ReviewerGroups,
} from './auto-review-model.ts';
import { reviewSettingsApi, reviewSettingsKey } from './review-settings-api.ts';

const SCOPE = { id: 'github-review-settings' };

interface SaveContext {
  previous: GithubReviewSettings | undefined;
}

export function useReviewSettings() {
  const queryClient = useQueryClient();
  const { remote, session } = useRemoteClient();
  const settings = useQuery({
    queryKey: reviewSettingsKey,
    queryFn: reviewSettingsApi.get,
    enabled: session !== undefined && !remote,
  });

  const save = useMutation<GithubReviewSettings, Error, GithubReviewSettings, SaveContext>({
    mutationKey: reviewSettingsKey,
    scope: SCOPE,
    mutationFn: (next) => reviewSettingsApi.save(toUpdate(next)),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: reviewSettingsKey });
      const previous = queryClient.getQueryData<GithubReviewSettings>(reviewSettingsKey);
      queryClient.setQueryData(reviewSettingsKey, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(reviewSettingsKey, context.previous);
      void queryClient.invalidateQueries({ queryKey: reviewSettingsKey });
    },
    onSuccess: (saved) => {
      if (queryClient.isMutating({ mutationKey: reviewSettingsKey }) > 1) return;
      queryClient.setQueryData(reviewSettingsKey, saved);
    },
  });

  const change = (update: AutoReviewChange) => {
    const current = queryClient.getQueryData<GithubReviewSettings>(reviewSettingsKey);
    if (!current) return;
    save.reset();
    save.mutate(applyChange(current, update));
  };

  return {
    query: settings,
    settings: settings.data,
    saveError: save.isError ? save.error.message : null,
    change,
  };
}

export function useReviewerGroups(): { groups: ReviewerGroups; loading: boolean } {
  const { teammates, loading } = useTeammates();
  const workflows = useWorkflows();
  const groups = useMemo<ReviewerGroups>(() => {
    const faceOf = new Map(teammates.map((spark) => [spark.id, spark.face]));
    return {
      sparks: teammates.map((spark) => ({
        kind: 'spark',
        id: spark.id,
        name: spark.name,
        detail: spark.role,
        faces: [spark.face],
      })),
      workflows: (workflows.data ?? []).map((workflow) => {
        const steps = workflow.stages.flat();
        return {
          kind: 'workflow',
          id: workflow.id,
          name: workflow.name,
          detail: `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`,
          faces: steps.flatMap((step) => faceOf.get(step.sparkId) ?? []).slice(0, 3),
        };
      }),
    };
  }, [teammates, workflows.data]);
  return { groups, loading: loading || workflows.isPending };
}
