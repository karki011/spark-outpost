import type { QueryKey } from '@tanstack/react-query';
import type { AppEvent } from '@spark-outpost/contracts';
import { analyticsKeys } from '../../analytics/analytics-api.ts';
import { queryKeys } from '../../api/client.ts';
import { outcomeKeys } from '../../api/outcomes.ts';
import { auditKeys } from '../../audit/audit-api.ts';
import { homeKeys } from '../../home/home-api.ts';
import { taskKeys } from '../../tasks/task-api.ts';

interface Invalidation {
  queryKey: QueryKey;
  exact?: boolean;
}

export const LIVE_ROOTS: readonly string[] = [
  queryKeys.conversations[0],
  queryKeys.conversationSearches[0],
  homeKeys.all[0],
  taskKeys.all[0],
  auditKeys.all[0],
  outcomeKeys.all[0],
  analyticsKeys.all[0],
  queryKeys.usageSummary[0],
];

export function isLiveQueryKey(key: QueryKey): boolean {
  return typeof key[0] === 'string' && LIVE_ROOTS.includes(key[0]);
}

const list: Invalidation = { queryKey: queryKeys.conversations, exact: true };
const search: Invalidation = { queryKey: queryKeys.conversationSearches };
const tasks: Invalidation = { queryKey: taskKeys.all };
const spend: Invalidation = { queryKey: homeKeys.spendAll };
const health: Invalidation = { queryKey: homeKeys.health, exact: true };
const digest: Invalidation = { queryKey: homeKeys.digest, exact: true };
const usage: Invalidation = { queryKey: queryKeys.usageSummary, exact: true };
const analytics: Invalidation = { queryKey: analyticsKeys.all };

function conversationScoped(event: AppEvent, withAudit: boolean): Invalidation[] {
  const id = event.conversationId;
  if (!id) return [];
  const detail: Invalidation = { queryKey: queryKeys.conversation(id), exact: true };
  return withAudit ? [detail, { queryKey: auditKeys.summary(id), exact: true }] : [detail];
}

function outcome(event: AppEvent): Invalidation[] {
  return event.runId ? [{ queryKey: outcomeKeys.run(event.runId), exact: true }] : [];
}

function invalidationsFor(event: AppEvent): Invalidation[] {
  switch (event.kind) {
    case 'conversation':
      return [list, search, ...conversationScoped(event, false)];
    case 'run':
      return [
        list,
        ...conversationScoped(event, true),
        tasks,
        spend,
        health,
        usage,
        analytics,
        ...outcome(event),
      ];
    case 'step':
      return [list, ...conversationScoped(event, true)];
    case 'approval':
      return [list, ...conversationScoped(event, true), tasks];
    case 'orchestration':
      return conversationScoped(event, false);
    case 'task':
      return [list, ...conversationScoped(event, false), tasks];
    case 'digest':
      return [digest, spend];
    case 'outcome':
      return [...outcome(event), analytics];
    case 'map':
      return [];
  }
}

export function mergeInvalidations(events: readonly AppEvent[]): Invalidation[] {
  const unique = new Map<string, Invalidation>();
  for (const invalidation of events.flatMap(invalidationsFor)) {
    unique.set(JSON.stringify([invalidation.queryKey, invalidation.exact ?? false]), invalidation);
  }
  return [...unique.values()];
}
