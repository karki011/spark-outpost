import type { CSSProperties } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { providerName } from '../chat/provider-name.ts';
import { InfoTip } from '../ui/InfoTip.tsx';
import { XIcon } from '../ui/icons.tsx';
import type { FeedRow } from './needs-model.ts';

const SORT_RULE =
  'Flagged by rules; each row says why. Waiting on you first, then errors, then finished chats you have not opened.';

interface NeedsFeedProps {
  rows: readonly FeedRow[];
  connectHint: boolean;
  onOpen: (chat: ConversationSummary) => void;
  onConnect: () => void;
  onDismissHint: () => void;
}

function RowGlyph({ row }: { row: FeedRow }) {
  const { provider, expression } = row.item;
  if (!provider) return <span className="g provider-dot" aria-hidden="true" />;
  return (
    <span className="g" role="img" aria-label={`Chat with ${providerName(provider)}`}>
      <AgentBlob provider={provider} size={18} expression={expression} />
    </span>
  );
}

export function NeedsFeed({ rows, connectHint, onOpen, onConnect, onDismissHint }: NeedsFeedProps) {
  return (
    <>
      <div className="feed-bar">
        <InfoTip topic="how this list is sorted" text={SORT_RULE} />
      </div>
      <ul className="lrows" aria-label="Needs you">
        {rows.map((row, index) => {
          const { chat, action, sub } = row.item;
          return (
            <li key={chat.id} className="lrow" style={{ '--i': index } as CSSProperties}>
              <button type="button" className="lr-main" onClick={() => onOpen(chat)}>
                <RowGlyph row={row} />
                <span className="t">{chat.title}</span>
                <span className="why-r">
                  <i className={`sev ${row.severity}`} aria-hidden="true" />
                  <span className="txt" title={sub}>
                    {sub}
                  </span>
                </span>
                <span className="age" title={row.ageTitle}>
                  {row.age}
                </span>
              </button>
              <span className="lr-acts">
                <button
                  type="button"
                  className={row.primary ? 'qa primary' : 'qa'}
                  aria-label={`${action}: ${chat.title}`}
                  onClick={() => onOpen(chat)}
                >
                  {action}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {connectHint && (
        <p className="feed-foot">
          Tickets and pull requests from Linear or Jira can show here too.
          <button type="button" className="hlink" onClick={onConnect}>
            Connect
          </button>
          <button
            type="button"
            className="feed-x"
            aria-label="Don’t show this again"
            title="Don’t show this again"
            onClick={onDismissHint}
          >
            <XIcon />
          </button>
        </p>
      )}
    </>
  );
}
