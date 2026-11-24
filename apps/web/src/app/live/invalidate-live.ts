import type { QueryClient, QueryKey } from '@tanstack/react-query';

export interface LiveInvalidation {
  queryKey: QueryKey;
  exact?: boolean;
}

const trailing = new WeakMap<QueryClient, Set<string>>();

function trailingOf(client: QueryClient): Set<string> {
  const known = trailing.get(client);
  if (known) return known;
  const created = new Set<string>();
  trailing.set(client, created);
  return created;
}

export function invalidateLive(client: QueryClient, invalidation: LiveInvalidation): void {
  const waiting = trailingOf(client);
  const id = JSON.stringify([invalidation.queryKey, invalidation.exact ?? false]);
  if (waiting.has(id)) return;
  const inFlight =
    client.isFetching({
      ...invalidation,
      predicate: (query) => query.state.data !== undefined,
    }) > 0;
  const settled = client.invalidateQueries(invalidation, { cancelRefetch: false });
  if (!inFlight) return;
  waiting.add(id);
  const again = () => {
    waiting.delete(id);
    invalidateLive(client, invalidation);
  };
  void settled.then(again, again);
}
