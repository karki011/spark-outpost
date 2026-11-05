import './row-links.css';
import { ticketSourceNames, type InboxTicket } from '@spark-outpost/contracts';
import { originText, rowPull } from './development-model.ts';
import { Glyph } from './ticket-icons.tsx';
import { chatStateText, pullBadge, pullNumber } from './row-links.ts';
import { pullUrl, safeUrl } from './ticket-model.ts';

interface RowLinksProps {
  ticket: InboxTicket;
  onOpenChat: () => void;
  onOpenPr: (url: string) => void;
}

export function RowLinks({ ticket, onOpenChat, onOpenPr }: RowLinksProps) {
  const chat = ticket.chat;
  const url = safeUrl(pullUrl(ticket));
  const shown = url ? rowPull(ticket, url) : null;
  const badge = shown?.badge ?? pullBadge(ticket.pullRequest);
  const number = url ? (shown?.number ?? pullNumber(ticket, url)) : null;
  const pullName = number ? `PR #${number}` : 'PR';
  const repo = shown?.repo ? ` in ${shown.repo}` : '';
  const more = shown?.more ?? 0;
  const others = more > 0 ? ` and ${more} more` : '';
  const origin =
    shown?.origin && shown.origin !== 'spark'
      ? ` · ${originText(shown.origin, ticketSourceNames[ticket.source])}`
      : '';
  return (
    <div className="ir-links">
      {chat && (
        <button
          type="button"
          className={`irl-chat ${chat.state}`}
          aria-label={`Open the chat for ${ticket.key}: ${chat.title}, ${chatStateText(chat.state)}`}
          title={`Chat: ${chat.title} · ${chatStateText(chat.state)}`}
          onClick={onOpenChat}
        >
          <Glyph name="chat" size={14} />
          <i aria-hidden="true" />
        </button>
      )}
      {url && (
        <button
          type="button"
          className={`irl-pr ${badge.tone}`}
          aria-label={`Open ${pullName} for ${ticket.key}, ${badge.label}${others}, in your browser`}
          title={`${pullName}${repo} · ${badge.label}${origin}${others}`}
          onClick={() => onOpenPr(url)}
        >
          <Glyph name={badge.glyph} size={13} />
          <span>{number ? `#${number}` : 'PR'}</span>
          {more > 0 && <span className="irl-more">+{more}</span>}
        </button>
      )}
    </div>
  );
}
