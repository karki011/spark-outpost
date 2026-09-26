import './attention-card.css';
import { useId, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import { attentionLine, type Attention, waitingHeadline } from './row-state.ts';

const STACKED_BLOBS = 3;

function WaitingBlob({ chat }: { chat: ConversationSummary }) {
  const attention = chat.attention;
  if (attention?.agentName) {
    return (
      <CrewBlob
        name={attention.agentName}
        provider={attention.provider ?? 'claude'}
        state="waiting"
        size={22}
      />
    );
  }
  if (attention?.provider) {
    return <AgentBlob provider={attention.provider} size={22} expression="unsure" />;
  }
  return <i className="ask" aria-hidden="true" />;
}

function Chevron({ open }: { open?: boolean }) {
  return (
    <svg
      className={open ? 'attn-chev open' : 'attn-chev'}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

interface AttentionCardProps {
  waiting: Attention;
  onJump: (chat: ConversationSummary) => void;
}

export function AttentionCard({ waiting, onJump }: AttentionCardProps) {
  const signature = waiting.others
    .map((chat) => `${chat.id}:${chat.title}:${attentionLine(chat.attention)}`)
    .join('|');
  const [shown, setShown] = useState({ signature, waiting });
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  if (waiting.text && signature !== shown.signature) setShown({ signature, waiting });
  const visible = waiting.text !== null;
  const { others, text } = visible ? waiting : shown.waiting;
  const single = others.length === 1 ? others[0]! : null;

  return (
    <div className={`collapse attn${visible ? ' open' : ''}`} inert={!visible}>
      <div>
        <div className="attn-card">
          {single ? (
            <button type="button" className="attn-btn" onClick={() => onJump(single)}>
              <span className="attn-ava" aria-hidden="true">
                <WaitingBlob chat={single} />
              </span>
              <span className="attn-txt">
                <b>{text}</b>
                <small>{attentionLine(single.attention)}</small>
              </span>
              <Chevron />
            </button>
          ) : (
            <button
              type="button"
              className="attn-btn"
              aria-expanded={listOpen}
              aria-controls={listId}
              onClick={() => setListOpen(!listOpen)}
            >
              <span className="attn-ava stack" aria-hidden="true">
                {others.slice(0, STACKED_BLOBS).map((chat) => (
                  <WaitingBlob key={chat.id} chat={chat} />
                ))}
              </span>
              <span className="attn-txt">
                <b>{text}</b>
              </span>
              <Chevron open={listOpen} />
            </button>
          )}
          {!single && (
            <div className={`collapse${listOpen ? ' open' : ''}`} inert={!listOpen}>
              <div>
                <ul className="attn-list" id={listId} aria-label="Chats waiting for you">
                  {others.map((chat) => (
                    <li key={chat.id}>
                      <button type="button" onClick={() => onJump(chat)}>
                        <span className="attn-ava" aria-hidden="true">
                          <WaitingBlob chat={chat} />
                        </span>
                        <span className="attn-txt">
                          <b>{waitingHeadline(chat)}</b>
                          <small>{attentionLine(chat.attention)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
