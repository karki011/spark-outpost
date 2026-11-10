import {
  type CommentTicketRequest,
  assignTicketResponseSchema,
  attentionSettingsSchema,
  startTicketResponseSchema,
  ticketConnectionsSchema,
  ticketInboxSchema,
  ticketMoveOptionsSchema,
  ticketSearchSchema,
  ticketSyncSchema,
  ticketViewSchema,
  type AssignTicketRequest,
  type AssignTicketResponse,
  type AttentionSettings,
  type DismissTicketRequest,
  type SaveTicketConnectionRequest,
  type SnoozeTicketRequest,
  type StartTicketRequest,
  type StartTicketResponse,
  type TicketConnections,
  type TicketInbox,
  type TicketStatus,
  type TicketSync,
  type TicketMoveOptions,
  type TicketSearch,
  type TicketSearchQuery,
  type TicketSourceId,
  type TicketView,
  type UpdateAttentionSettings,
  type UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { request } from '../api/client.ts';

export const ticketKeys = {
  all: ['tickets'] as const,
  inbox: ['tickets', 'inbox'] as const,
  connections: ['tickets', 'connections'] as const,
  attentionSettings: ['tickets', 'attention-settings'] as const,
  moveOptions: (source: TicketSourceId) => ['tickets', 'move-options', source] as const,
  disconnect: (source: TicketSourceId): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, `/tickets/connections/${source}`, { method: 'DELETE' }),
  updateSettings: (
    source: TicketSourceId,
    body: UpdateTicketSettingsRequest,
  ): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, `/tickets/connections/${source}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  searches: ['tickets', 'search'] as const,
  search: (query: TicketSearchQuery) => ['tickets', 'search', query] as const,
  view: (source: TicketSourceId, key: string) => ['tickets', 'view', source, key] as const,
};

export function refreshTicket(
  queryClient: QueryClient,
  source: TicketSourceId,
  key: string,
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ticketKeys.inbox }),
    queryClient.invalidateQueries({ queryKey: ticketKeys.view(source, key) }),
    queryClient.invalidateQueries({ queryKey: ticketKeys.searches }),
  ]);
}

const ticketPath = (source: TicketSourceId, key: string) =>
  `/tickets/${source}/${encodeURIComponent(key)}`;

function searchParams(query: TicketSearchQuery): string {
  const params = new URLSearchParams({ q: query.q, assignee: query.assignee });
  if (query.source) params.set('source', query.source);
  if (query.project) params.set('project', query.project);
  if (query.status) params.set('status', query.status);
  return params.toString();
}

export const ticketsApi = {
  inbox: (): Promise<TicketInbox> => request(ticketInboxSchema, '/tickets/inbox'),
  refreshedInbox: (): Promise<TicketInbox> =>
    request(ticketInboxSchema, '/tickets/inbox', { headers: { 'Cache-Control': 'no-cache' } }),
  connections: (): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, '/tickets/connections'),
  moveOptions: (source: TicketSourceId): Promise<TicketMoveOptions> =>
    request(ticketMoveOptionsSchema, `/tickets/connections/${source}/move-options`),
  connect: (body: SaveTicketConnectionRequest): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, `/tickets/connections/${body.source}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  disconnect: (source: TicketSourceId): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, `/tickets/connections/${source}`, { method: 'DELETE' }),
  updateSettings: (
    source: TicketSourceId,
    body: UpdateTicketSettingsRequest,
  ): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, `/tickets/connections/${source}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  attentionSettings: (): Promise<AttentionSettings> =>
    request(attentionSettingsSchema, '/tickets/attention-settings'),
  updateAttentionSettings: (body: UpdateAttentionSettings): Promise<AttentionSettings> =>
    request(attentionSettingsSchema, '/tickets/attention-settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  search: (query: TicketSearchQuery): Promise<TicketSearch> =>
    request(ticketSearchSchema, `/tickets/search?${searchParams(query)}`),
  view: (source: TicketSourceId, key: string): Promise<TicketView> =>
    request(ticketViewSchema, ticketPath(source, key)),
  comment: (source: TicketSourceId, key: string, body: CommentTicketRequest) =>
    request(z.object({ ok: z.boolean() }), `${ticketPath(source, key)}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  transition: (source: TicketSourceId, key: string, status: TicketStatus): Promise<TicketSync> =>
    request(ticketSyncSchema, `${ticketPath(source, key)}/transition`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  assign: (
    source: TicketSourceId,
    key: string,
    body: AssignTicketRequest,
  ): Promise<AssignTicketResponse> =>
    request(assignTicketResponseSchema, `${ticketPath(source, key)}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  snooze: (source: TicketSourceId, key: string, body: SnoozeTicketRequest): Promise<TicketInbox> =>
    request(ticketInboxSchema, `${ticketPath(source, key)}/snooze`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  unsnooze: (source: TicketSourceId, key: string): Promise<TicketInbox> =>
    request(ticketInboxSchema, `${ticketPath(source, key)}/snooze`, { method: 'DELETE' }),
  dismiss: (
    source: TicketSourceId,
    key: string,
    body: DismissTicketRequest,
  ): Promise<TicketInbox> =>
    request(ticketInboxSchema, `${ticketPath(source, key)}/dismiss`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  undismiss: (source: TicketSourceId, key: string): Promise<TicketInbox> =>
    request(ticketInboxSchema, `${ticketPath(source, key)}/dismiss`, { method: 'DELETE' }),
  noticeSeen: (source: TicketSourceId, key: string, notice: string): Promise<{ ok: boolean }> =>
    request(z.object({ ok: z.boolean() }), `${ticketPath(source, key)}/notice-seen`, {
      method: 'PUT',
      body: JSON.stringify({ notice }),
    }),
  start: (
    source: TicketSourceId,
    key: string,
    body: Partial<StartTicketRequest> & Pick<StartTicketRequest, 'conversationId' | 'messageId'>,
  ): Promise<StartTicketResponse> =>
    request(startTicketResponseSchema, `${ticketPath(source, key)}/start`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
