import type { QueryKey } from '@tanstack/react-query';
import type { AppEvent } from '@spark-outpost/contracts';
import { analyticsKeys } from '../../analytics/analytics-api.ts';
import { agentTerminalKeys } from '../../api/agent-terminals.ts';
import { queryKeys } from '../../api/client.ts';
import { outcomeKeys } from '../../api/outcomes.ts';
import { previewKeys } from '../../api/preview.ts';
import { auditKeys } from '../../audit/audit-api.ts';
import { mapKeys } from '../../map/map-api.ts';
import { outpostKeys } from '../../outposts/outposts-api.ts';
import { prWatchesKey } from '../../chat/pull-request/pr-follow-up-api.ts';
import { diffKeys } from '../../diff/diff-api.ts';
import { homeKeys } from '../../home/home-api.ts';
import { taskKeys } from '../../tasks/task-api.ts';
import { teammateKeys } from '../../teammates/teammates-api.ts';
import {
  nativeTerminalKey,
  terminalRemoteKey,
  terminalStartKey,
} from '../../terminal/terminal-api.ts';
import { ticketKeys } from '../../tickets/tickets-api.ts';
import { sparkPauseKey } from '../pause/spark-pause-api.ts';

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
  teammateKeys.all[0],
  ticketKeys.all[0],
  previewKeys.all[0],
  outpostKeys.all[0],
  agentTerminalKeys.all[0],
];

export function isLiveQueryKey(key: QueryKey): boolean {
  return typeof key[0] === 'string' && LIVE_ROOTS.includes(key[0]);
}

const list: Invalidation = { queryKey: queryKeys.conversations, exact: true };
const search: Invalidation = { queryKey: queryKeys.conversationSearches };
const tasks: Invalidation = { queryKey: taskKeys.all };
const changeSummaries: Invalidation = { queryKey: diffKeys.summaries };
const spend: Invalidation = { queryKey: homeKeys.spendAll };
const health: Invalidation = { queryKey: homeKeys.health, exact: true };
const digest: Invalidation = { queryKey: homeKeys.digest, exact: true };
const today: Invalidation = { queryKey: homeKeys.today, exact: true };
const usage: Invalidation = { queryKey: queryKeys.usageSummary, exact: true };
const analytics: Invalidation = { queryKey: analyticsKeys.all };
const teammates: Invalidation = { queryKey: teammateKeys.all };
const ticketInbox: Invalidation = { queryKey: ticketKeys.inbox, exact: true };
const ticketConnections: Invalidation = { queryKey: ticketKeys.connections, exact: true };
const outposts: Invalidation = { queryKey: outpostKeys.all };

function conversationScoped(event: AppEvent, withAudit: boolean): Invalidation[] {
  const id = event.conversationId;
  if (!id) return [];
  const detail: Invalidation = { queryKey: queryKeys.conversation(id), exact: true };
  return withAudit ? [detail, { queryKey: auditKeys.summary(id), exact: true }] : [detail];
}

function terminalRemote(event: AppEvent): Invalidation[] {
  const id = event.conversationId;
  return id ? [{ queryKey: terminalRemoteKey(id), exact: true }] : [];
}

function chatPreview(event: AppEvent): Invalidation[] {
  const id = event.conversationId;
  return id ? [{ queryKey: previewKeys.chat(id), exact: true }] : [];
}

function outcome(event: AppEvent): Invalidation[] {
  return event.runId ? [{ queryKey: outcomeKeys.run(event.runId), exact: true }] : [];
}

function invalidationsFor(event: AppEvent): Invalidation[] {
  switch (event.kind) {
    case 'conversation':
      return [
        list,
        search,
        teammates,
        ...conversationScoped(event, false),
        ...chatPreview(event),
        ...terminalRemote(event),
      ];
    case 'seen':
      return [list, search];
    case 'run':
      return [
        list,
        teammates,
        ...conversationScoped(event, true),
        ...chatPreview(event),
        tasks,
        spend,
        today,
        health,
        usage,
        analytics,
        outposts,
        ...outcome(event),
        ...terminalRemote(event),
      ];
    case 'step':
      return [list, ...conversationScoped(event, true), changeSummaries, ...terminalRemote(event)];
    case 'subagent':
      return [list, ...conversationScoped(event, true)];
    case 'approval':
      return [list, teammates, ...conversationScoped(event, true), tasks, today, outposts];
    case 'orchestration':
      return conversationScoped(event, false);
    case 'task':
      return [list, ...conversationScoped(event, false), tasks, today];
    case 'digest':
      return [digest, spend];
    case 'outcome':
      return [...outcome(event), analytics];
    case 'map':
      return [{ queryKey: mapKeys.all }];
    case 'teammate':
      return [teammates, list];
    case 'pull_request':
      return event.conversationId
        ? [list, { queryKey: prWatchesKey(event.conversationId), exact: true }, ticketInbox]
        : [];
    case 'ticket':
      return [ticketInbox, ticketConnections];
    case 'preview':
      return [{ queryKey: previewKeys.all }];
    case 'outpost_changed':
      return [list, outposts];
    case 'agent_terminal':
      return event.conversationId
        ? [{ queryKey: agentTerminalKeys.chat(event.conversationId), exact: true }]
        : [{ queryKey: agentTerminalKeys.all }];
    case 'terminal_start':
      return event.conversationId
        ? [
            { queryKey: terminalStartKey(event.conversationId), exact: true },
            { queryKey: nativeTerminalKey(event.conversationId), exact: true },
          ]
        : [];
    case 'spark_pause':
      return [{ queryKey: sparkPauseKey, exact: true }];
  }
}

export function isStepEvent(event: AppEvent): boolean {
  return event.kind === 'step';
}

function covers(broad: Invalidation, narrow: Invalidation): boolean {
  if (broad === narrow || broad.exact || broad.queryKey.length >= narrow.queryKey.length) {
    return false;
  }
  return broad.queryKey.every((part, index) => part === narrow.queryKey[index]);
}

export function mergeInvalidations(events: readonly AppEvent[]): Invalidation[] {
  const unique = new Map<string, Invalidation>();
  for (const invalidation of events.flatMap(invalidationsFor)) {
    unique.set(JSON.stringify([invalidation.queryKey, invalidation.exact ?? false]), invalidation);
  }
  const all = [...unique.values()];
  return all.filter((narrow) => !all.some((broad) => covers(broad, narrow)));
}
