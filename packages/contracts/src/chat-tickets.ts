import { z } from 'zod';
import { ticketKeySchema, ticketSourceIdSchema, ticketStatusSchema } from './tickets.ts';

export const chatTicketSchema = z.object({
  source: ticketSourceIdSchema,
  key: z.string(),
  title: z.string(),
  url: z.string(),
  status: ticketStatusSchema,
  statusName: z.string(),
});
export type ChatTicket = z.infer<typeof chatTicketSchema>;

export const chatTicketsSchema = z.object({
  linked: z.array(chatTicketSchema),
  suggested: z.array(chatTicketSchema),
  mentioned: z.array(chatTicketSchema),
});
export type ChatTickets = z.infer<typeof chatTicketsSchema>;

export const linkChatTicketRequestSchema = z.object({
  source: ticketSourceIdSchema,
  key: ticketKeySchema,
});
export type LinkChatTicketRequest = z.infer<typeof linkChatTicketRequestSchema>;
