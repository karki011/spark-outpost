import { queryOptions } from '@tanstack/react-query';
import type { GitStatus } from '@spark-outpost/contracts';
import { setupApi } from '../api/setup.ts';
import { MIN_CHECK_MS, type CheckMood } from '../tickets/connect-check.ts';
import { atLeast } from '../ui/min-duration.ts';

export const gitStatusQuery = queryOptions({
  queryKey: ['git-status'] as const,
  queryFn: () => atLeast(setupApi.git(), MIN_CHECK_MS),
  staleTime: Infinity,
});

export function gitLabel(status: GitStatus): string {
  if (!status.installed) return 'Git not installed';
  return status.version ? `Git ${status.version}` : 'Git';
}

export function gitMood(status: GitStatus | undefined, checking: boolean): CheckMood {
  if (checking || !status) return 'checking';
  return status.installed ? 'happy' : 'puzzled';
}
