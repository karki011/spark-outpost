import './compaction.css';
import { useId, useState } from 'react';
import type { Compaction, Continuation } from '@spark-outpost/contracts';
import { Markdown } from '../markdown/Markdown.tsx';
import { compactionTitle, tokensLine } from './compaction-text.ts';

interface CompactionDividerProps {
  compaction: Compaction;
  onOpenChat: (conversationId: string) => void;
}

export function CompactionDivider({ compaction, onOpenChat }: CompactionDividerProps) {
  const [open, setOpen] = useState(false);
  const summaryId = useId();
  const tokens = tokensLine(compaction);
  const from = compaction.fromConversationId;
  return (
    <div className="cmp" role="group" aria-label={compactionTitle(compaction)}>
      <div className="cmp-line">
        <span className="cmp-rule" aria-hidden="true" />
        <span className="cmp-label">
          <b>{compactionTitle(compaction)}</b>
          {tokens && <span className="cmp-tokens">{tokens}</span>}
        </span>
        <span className="cmp-rule" aria-hidden="true" />
      </div>
      <div className="cmp-acts">
        {compaction.summary && (
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={open}
            aria-controls={summaryId}
            onClick={() => setOpen((shown) => !shown)}
          >
            {open ? 'Hide summary' : 'View summary'}
          </button>
        )}
        {from && (
          <button type="button" className="btn ghost sm" onClick={() => onOpenChat(from)}>
            Open the earlier chat
          </button>
        )}
      </div>
      {compaction.summary && (
        <div id={summaryId} className="cmp-summary" hidden={!open}>
          {open && <Markdown text={compaction.summary} />}
        </div>
      )}
    </div>
  );
}

interface ContinuedDividerProps {
  continuation: Continuation;
  onOpenChat: (conversationId: string) => void;
}

export function ContinuedDivider({ continuation, onOpenChat }: ContinuedDividerProps) {
  return (
    <div className="cmp" role="group" aria-label="Continued in a fresh chat">
      <div className="cmp-line">
        <span className="cmp-rule" aria-hidden="true" />
        <span className="cmp-label">
          <b>Continued in a fresh chat</b>
          <span className="cmp-tokens">{continuation.title}</span>
        </span>
        <span className="cmp-rule" aria-hidden="true" />
      </div>
      <div className="cmp-acts">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => onOpenChat(continuation.conversationId)}
        >
          Open the fresh chat
        </button>
      </div>
    </div>
  );
}
