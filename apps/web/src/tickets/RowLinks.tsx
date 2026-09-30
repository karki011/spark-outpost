import './row-links.css';
import type { InboxTicket } from '@spark-outpost/contracts';
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
  const badge = pullBadge(ticket.pullRequest);
  const number = url ? pullNumber(ticket, url) : null;
  const pullName = number ? `PR #${number}` : 'PR';
  const repo = ticket.pullRequest ? ` in ${ticket.pullRequest.repo}` : '';
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
          aria-label={`Open ${pullName} for ${ticket.key}, ${badge.label}, in your browser`}
          title={`${pullName}${repo} · ${badge.label}`}
          onClick={() => onOpenPr(url)}
        >
          <Glyph name={badge.glyph} size={13} />
          <span>{number ? `#${number}` : 'PR'}</span>
        </button>
      )}
    </div>
  );
}
