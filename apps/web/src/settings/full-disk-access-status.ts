import { queryOptions } from '@tanstack/react-query';
import { setupApi } from '../api/setup.ts';

export const fullDiskAccessQuery = queryOptions({
  queryKey: ['full-disk-access'] as const,
  queryFn: setupApi.fullDiskAccess,
  refetchOnWindowFocus: true,
});
