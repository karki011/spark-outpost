import './chat-tickets.css';
import type { ChatTicket } from '@spark-outpost/contracts';
import { CloseIcon } from '../../tasks/TaskIcons.tsx';
import { Glyph } from '../../tickets/ticket-icons.tsx';
import { requestTicket } from '../../tickets/ticket-request.ts';
import type { ChatTicketsState } from './use-chat-tickets.ts';

function OpenTicket({ ticket, withTitle }: { ticket: ChatTicket; withTitle?: boolean }) {
  return (
    <button
      type="button"
      className="ctb-ticket"
      title={`${ticket.key}: ${ticket.title}`}
      onClick={() => requestTicket(ticket)}
    >
      <span className="chat-ticket-key">{ticket.key}</span>
      {withTitle && <span className="ctb-title">{ticket.title}</span>}
      <span className="sr-only">, open in Tickets</span>
    </button>
  );
}

function Suggestions({ chat }: { chat: ChatTicketsState }) {
  return (
    <div className="ctb-line" role="group" aria-label="Suggested tickets">
      <Glyph name="ticket" size={13} />
      <span>Link this chat to</span>
      {chat.suggested.map((ticket, index) => (
        <span key={ticket.key} className="ctb-pick">
          {index > 0 && <span aria-hidden="true">/</span>}
          <button
            type="button"
            className="ctb-link"
            title={`${ticket.key}: ${ticket.title}`}
            disabled={chat.busy}
            onClick={() => chat.link(ticket)}
          >
            {ticket.key}
            <span className="sr-only">: link this chat to {ticket.title}</span>
          </button>
        </span>
      ))}
      <span className="ctb-q" aria-hidden="true">
        ?
      </span>
      <button
        type="button"
        className="ctb-quiet"
        disabled={chat.busy}
        onClick={() => chat.dismiss()}
      >
        Not now
      </button>
    </div>
  );
}

function Mentions({ chat }: { chat: ChatTicketsState }) {
  const only = chat.mentioned.length === 1 ? chat.mentioned[0] : null;
  return (
    <div className="ctb-line" role="group" aria-label="Tickets this message mentions">
      <Glyph name="ticket" size={13} />
      <span>Mentions</span>
      {chat.mentioned.map((ticket) => (
        <OpenTicket key={ticket.key} ticket={ticket} withTitle={only !== null} />
      ))}
      {only && (
        <button
          type="button"
          className="ctb-link"
          disabled={chat.busy}
          onClick={() => chat.link(only)}
        >
          Link this chat
          <span className="sr-only"> to {only.key}</span>
        </button>
      )}
      <button
        type="button"
        className="icon-btn ctb-hide"
        aria-label="Hide mentioned tickets"
        onClick={chat.hideMentions}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

export function ChatTicketBar({ chat }: { chat: ChatTicketsState }) {
  const { unlinked } = chat;
  const visible =
    chat.suggested.length > 0 || chat.mentioned.length > 0 || unlinked !== null || chat.error;
  if (!visible) return null;
  return (
    <div className="chat-ticket-bar">
      {unlinked && (
        <div className="ctb-line" role="status">
          <span>Unlinked {unlinked.key} from this chat.</span>
          <button
            type="button"
            className="ctb-link"
            disabled={chat.busy}
            onClick={() => chat.link(unlinked)}
          >
            Undo
          </button>
        </div>
      )}
      {chat.suggested.length > 0 && <Suggestions chat={chat} />}
      {chat.suggested.length === 0 && chat.mentioned.length > 0 && <Mentions chat={chat} />}
      {chat.error && (
        <p className="ctb-error" role="alert">
          {chat.error}
        </p>
      )}
    </div>
  );
}
