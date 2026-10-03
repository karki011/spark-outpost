import type { ReactNode } from 'react';
import { LoadRetry } from './LoadRetry.tsx';
import { useSlowLoad } from './use-slow-load.ts';

export interface WaitableQuery {
  data: unknown;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch(): Promise<unknown>;
}

interface QueryWaitProps {
  query: WaitableQuery;
  what: string;
  children: ReactNode;
}

export function QueryWait({ query, what, children }: QueryWaitProps) {
  const slow = useSlowLoad(query.isPending);
  const retry = () => void query.refetch();
  if (query.isError && query.data === undefined) {
    return (
      <LoadRetry
        what={what}
        error={query.error?.message ?? null}
        retrying={query.isFetching}
        onRetry={retry}
      />
    );
  }
  if (!query.isPending) return null;
  return (
    <>
      {children}
      {slow && <LoadRetry what={what} onRetry={retry} />}
    </>
  );
}
