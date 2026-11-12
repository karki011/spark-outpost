import type { QueryKey } from '@tanstack/react-query';
import type { AppEvent } from '@spark-outpost/contracts';
import { approvalKeys } from '../../api/approvals.ts';
import { analyticsKeys } from '../../analytics/analytics-api.ts';
import { agentTerminalKeys } from '../../api/agent-terminals.ts';
import { chatPortsKey } from '../../api/chat-ports.ts';
import { queryKeys } from '../../api/client.ts';
import { outcomeKeys } from '../../api/outcomes.ts';
import { previewKeys } from '../../api/preview.ts';
import { auditKeys } from '../../audit/audit-api.ts';
import { mapKeys } from '../../map/map-api.ts';
import { outpostKeys } from '../../outposts/outposts-api.ts';
import { prWatchesKey } from '../../chat/pull-request/pr-follow-up-api.ts';
import { chatDraftsKey } from '../../chat/outpost/chat-drafts.ts';
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
import { calendarKeys } from '../../calendar/calendar-api.ts';
import { islandRequestsKey } from '../../island/island-requests.ts';
import { attentionKey } from '../../attention/attention-api.ts';
import { sparkPauseKey } from '../pause/spark-pause-api.ts';

type RunStreamed = (runId: string) => boolean;

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
  queryKeys.planUsage[0],
  teammateKeys.all[0],
  ticketKeys.all[0],
  previewKeys.all[0],
  outpostKeys.all[0],
  agentTerminalKeys.all[0],
  chatPortsKey[0],
  calendarKeys.all[0],
  islandRequestsKey[0],
  attentionKey[0],
];

export function isLiveQueryKey(key: QueryKey): boolean {
  return typeof key[0] === 'string' && LIVE_ROOTS.includes(key[0]);
}

const list: Invalidation = { queryKey: queryKeys.conversations, exact: true };
const attention: Invalidation = { queryKey: attentionKey, exact: true };
const search: Invalidation = { queryKey: queryKeys.conversationSearches };
const tasks: Invalidation = { queryKey: taskKeys.all };
const changeSummaries: Invalidation = { queryKey: diffKeys.summaries };
const spend: Invalidation = { queryKey: homeKeys.spendAll };
const health: Invalidation = { queryKey: homeKeys.health, exact: true };
const digest: Invalidation = { queryKey: homeKeys.digest, exact: true };
const recap: Invalidation = { queryKey: homeKeys.recap, exact: true };
const today: Invalidation = { queryKey: homeKeys.today, exact: true };
const usage: Invalidation = { queryKey: queryKeys.usageSummary, exact: true };
const planUsage: Invalidation = { queryKey: queryKeys.planUsage, exact: true };
const analytics: Invalidation = { queryKey: analyticsKeys.all };
const teammates: Invalidation = { queryKey: teammateKeys.all };
const ticketInbox: Invalidation = { queryKey: ticketKeys.inbox, exact: true };
const ticketConnections: Invalidation = { queryKey: ticketKeys.connections, exact: true };
const outposts: Invalidation = { queryKey: outpostKeys.all };
const outpostList: Invalidation = { queryKey: outpostKeys.list, exact: true };
const outpostDrafts: Invalidation = { queryKey: outpostKeys.drafts };
const mapProjects: Invalidation = { queryKey: mapKeys.projects };
const mapLinks: Invalidation = { queryKey: mapKeys.links([]) };
const mapUnmatched: Invalidation = { queryKey: mapKeys.unmatched([]) };
const mapLocated: Invalidation = { queryKey: ['map', 'locate'] };

function changedOutposts(event: AppEvent): Invalidation[] {
  if (!event.outpostId) return [outposts];
  return [
    { queryKey: outpostKeys.detail(event.outpostId), exact: true },
    outpostList,
    outpostDrafts,
  ];
}

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

function runChangesOf(event: AppEvent): Invalidation[] {
  return event.runId ? [{ queryKey: approvalKeys.changes(event.runId), exact: true }] : [];
}

function outcome(event: AppEvent): Invalidation[] {
  return event.runId ? [{ queryKey: outcomeKeys.run(event.runId), exact: true }] : [];
}

function stepInvalidations(event: AppEvent, streamed: RunStreamed): Invalidation[] {
  if (!event.phase) {
    return [
      list,
      ...conversationScoped(event, true),
      changeSummaries,
      ...runChangesOf(event),
      ...terminalRemote(event),
    ];
  }
  const id = event.conversationId;
  const detail = event.runId && streamed(event.runId) ? [] : conversationScoped(event, false);
  return [
    ...detail,
    ...(id ? [{ queryKey: auditKeys.summary(id), exact: true }] : []),
    ...(event.phase === 'finished' ? [changeSummaries, ...runChangesOf(event)] : []),
    ...terminalRemote(event),
  ];
}

function invalidationsFor(event: AppEvent, streamed: RunStreamed): Invalidation[] {
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
        planUsage,
        analytics,
        outposts,
        ...outcome(event),
        ...runChangesOf(event),
        ...terminalRemote(event),
      ];
    case 'step':
      return stepInvalidations(event, streamed);
    case 'usage':
      return conversationScoped(event, false);
    case 'subagent':
      return [list, ...conversationScoped(event, true)];
    case 'approval':
      return [list, teammates, ...conversationScoped(event, true), tasks, today, outposts];
    case 'orchestration':
      return conversationScoped(event, false);
    case 'task':
      return [list, ...conversationScoped(event, false), tasks, today];
    case 'digest':
      return [digest, recap, spend];
    case 'outcome':
      return [...outcome(event), analytics];
    case 'map':
      return [mapProjects, mapLinks, mapUnmatched, mapLocated];
    case 'teammate':
      return [teammates, list];
    case 'pull_request':
      return event.conversationId
        ? [
            list,
            { queryKey: prWatchesKey(event.conversationId), exact: true },
            ticketInbox,
            teammates,
          ]
        : [teammates];
    case 'ticket':
      return [ticketInbox, ticketConnections];
    case 'preview':
      return [{ queryKey: previewKeys.all }];
    case 'outpost_changed':
      return [
        list,
        ...changedOutposts(event),
        ...(event.conversationId
          ? [{ queryKey: chatDraftsKey(event.conversationId), exact: true }]
          : []),
      ];
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
    case 'calendar':
      return [{ queryKey: calendarKeys.all }];
    case 'island_request':
      return [{ queryKey: islandRequestsKey, exact: true }];
    case 'attention':
      return [list];
    case 'chat_ports':
      return [{ queryKey: chatPortsKey, exact: true }];
    case 'meeting':
      return event.meetingId
        ? [
            { queryKey: ['meetings', 'status'], exact: true },
            { queryKey: ['meetings', 'list'] },
            { queryKey: ['meetings', 'detail', event.meetingId], exact: true },
          ]
        : [{ queryKey: ['meetings'] }];
  }
}

function withAttention(invalidations: Invalidation[]): Invalidation[] {
  return invalidations.includes(list) ? [...invalidations, attention] : invalidations;
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

export function mergeInvalidations(
  events: readonly AppEvent[],
  streamed: RunStreamed = () => false,
): Invalidation[] {
  const unique = new Map<string, Invalidation>();
  const invalidations = events.flatMap((event) => withAttention(invalidationsFor(event, streamed)));
  for (const invalidation of invalidations) {
    unique.set(JSON.stringify([invalidation.queryKey, invalidation.exact ?? false]), invalidation);
  }
  const all = [...unique.values()];
  return all.filter((narrow) => !all.some((broad) => covers(broad, narrow)));
}
