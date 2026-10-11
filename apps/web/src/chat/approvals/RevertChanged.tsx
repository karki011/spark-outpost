import { useQuery } from '@tanstack/react-query';
import type { Run } from '@spark-outpost/contracts';
import { diffApi, diffKeys } from '../../diff/diff-api.ts';
import { RevertRun } from './RevertRun.tsx';
import { offersRevert } from './revert-offer.ts';

interface RevertChangedProps {
  run: Run;
  taskId: string | null;
  runIds: readonly string[];
}

export function RevertChanged({ run, taskId, runIds }: RevertChangedProps) {
  const summary = useQuery({
    queryKey: diffKeys.summary(taskId ?? ''),
    queryFn: () => diffApi.summary(taskId ?? ''),
    enabled: taskId !== null,
  });
  if (!offersRevert(run, summary.data?.runs ?? [], runIds)) return null;
  return <RevertRun run={run} />;
}
