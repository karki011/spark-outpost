import { chatTicketsSchema, type ChatTicket, type ChatTickets } from '@spark-outpost/contracts';
import { queryKeys, request } from '../../api/client.ts';

export const chatTicketsKey = (conversationId: string) =>
  [...queryKeys.conversation(conversationId), 'tickets'] as const;

const ticketBody = (ticket: Pick<ChatTicket, 'source' | 'key'>) =>
  JSON.stringify({ source: ticket.source, key: ticket.key });

const path = (conversationId: string, rest = '') =>
  `/conversations/${conversationId}/tickets${rest}`;

export const chatTicketsApi = {
  get: (conversationId: string): Promise<ChatTickets> =>
    request(chatTicketsSchema, path(conversationId)),
  link: (conversationId: string, ticket: ChatTicket): Promise<ChatTickets> =>
    request(chatTicketsSchema, path(conversationId), { method: 'POST', body: ticketBody(ticket) }),
  unlink: (conversationId: string, ticket: ChatTicket): Promise<ChatTickets> =>
    request(chatTicketsSchema, path(conversationId, '/unlink'), {
      method: 'POST',
      body: ticketBody(ticket),
    }),
  dismiss: (conversationId: string): Promise<ChatTickets> =>
    request(chatTicketsSchema, path(conversationId, '/dismiss'), { method: 'POST', body: '{}' }),
};
