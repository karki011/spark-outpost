import type { ConversationDetail } from '@spark-outpost/contracts';
import { attentionLine } from '../../conversations/row-state.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { JUMP_TRIES, scrollToAnchor } from '../../crew/scroll-to-anchor.ts';
import { RailFlagCard } from './RailFlags.tsx';

export function OpenItems({ detail }: { detail: ConversationDetail }) {
  const chat = detail.conversation;
  const flags = (detail.railFlags ?? []).filter((flag) => flag.status === 'open');
  const approvalId = chat.needsInput ? (chat.attention?.approvalId ?? null) : null;
  if (!approvalId && flags.length === 0) return null;
  return (
    <div className="open-items" role="group" aria-label="Open items">
      {approvalId && (
        <p className="open-wait" role="status">
          <span className="open-wait-dot" aria-hidden="true" />
          <span className="open-wait-text">
            <b>Waiting for you</b> {attentionLine(chat.attention)}
          </span>
          <button
            type="button"
            className="btn line sm"
            onClick={() => scrollToAnchor(approvalAnchor(approvalId), JUMP_TRIES)}
          >
            Answer
          </button>
        </p>
      )}
      {flags.map((flag) => (
        <RailFlagCard key={flag.id} flag={flag} conversationId={chat.id} />
      ))}
    </div>
  );
}
