import {
  assignTicketResponseSchema,
  startTicketResponseSchema,
  ticketConnectionsSchema,
  ticketInboxSchema,
  ticketSearchSchema,
  ticketViewSchema,
  type AssignTicketRequest,
  type AssignTicketResponse,
  type SaveTicketConnectionRequest,
  type StartTicketRequest,
  type StartTicketResponse,
  type TicketConnections,
  type TicketInbox,
  type TicketSearch,
  type TicketSearchQuery,
  type TicketSourceId,
  type TicketView,
  type UpdateTicketSettingsRequest,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const ticketKeys = {
  all: ['tickets'] as const,
  inbox: ['tickets', 'inbox'] as const,
  connections: ['tickets', 'connections'] as const,
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
  search: (query: TicketSearchQuery) => ['tickets', 'search', query] as const,
  view: (source: TicketSourceId, key: string) => ['tickets', 'view', source, key] as const,
};

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
  connections: (): Promise<TicketConnections> =>
    request(ticketConnectionsSchema, '/tickets/connections'),
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
  search: (query: TicketSearchQuery): Promise<TicketSearch> =>
    request(ticketSearchSchema, `/tickets/search?${searchParams(query)}`),
  view: (source: TicketSourceId, key: string): Promise<TicketView> =>
    request(ticketViewSchema, ticketPath(source, key)),
  assign: (
    source: TicketSourceId,
    key: string,
    body: AssignTicketRequest,
  ): Promise<AssignTicketResponse> =>
    request(assignTicketResponseSchema, `${ticketPath(source, key)}/assign`, {
      method: 'POST',
      body: JSON.stringify(body),
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
