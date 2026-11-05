import './chat-tickets.css';
import { ticketSourceNames, type ChatTicket } from '@spark-outpost/contracts';
import { CloseIcon } from '../../tasks/TaskIcons.tsx';
import { Glyph } from '../../tickets/ticket-icons.tsx';
import { requestTicket } from '../../tickets/ticket-request.ts';
import type { ChatTicketsState } from './use-chat-tickets.ts';

function TicketChip({ ticket, chat }: { ticket: ChatTicket; chat: ChatTicketsState }) {
  const source = ticketSourceNames[ticket.source];
  return (
    <span className="chat-ticket" role="group" aria-label={`Linked ticket ${ticket.key}`}>
      <button
        type="button"
        className="chat-ticket-open"
        title={`${source} · ${ticket.key}: ${ticket.title} · ${ticket.statusName}`}
        onClick={() => requestTicket(ticket)}
      >
        <Glyph name="ticket" size={13} />
        <span className="chat-ticket-key">{ticket.key}</span>
        <span className="chat-ticket-title">· {ticket.title}</span>
        <span className="sr-only">, open in Tickets</span>
      </button>
      <button
        type="button"
        className="icon-btn chat-ticket-unlink"
        aria-label={`Unlink ${ticket.key} from this chat`}
        title="Unlink"
        disabled={chat.busy}
        onClick={() => chat.unlink(ticket)}
      >
        <CloseIcon />
      </button>
    </span>
  );
}

export function ChatTicketChips({ chat }: { chat: ChatTicketsState }) {
  if (chat.linked.length === 0) return null;
  return (
    <>
      {chat.linked.map((ticket) => (
        <TicketChip key={`${ticket.source}:${ticket.key}`} ticket={ticket} chat={chat} />
      ))}
    </>
  );
}
