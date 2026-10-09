import { InfoIcon } from '../ui/icons.tsx';
import { MemberFace } from './MemberFace.tsx';
import { PrChip } from './PrChip.tsx';
import { requestFaceState } from './post-text.ts';
import type { StoryRowView } from './story-bar.ts';

interface StoryRowProps {
  row: StoryRowView;
  onOpenChat: (conversationId: string) => void;
  onFill: (text: string) => void;
}

export function StoryRow({ row, onOpenChat, onFill }: StoryRowProps) {
  const face = row.state === null ? 'idle' : requestFaceState(row.state);
  return (
    <li className="op-story-row" data-chat={row.conversationId}>
      <MemberFace chatId={row.conversationId} state={face} size="strip" />
      <button
        type="button"
        className="op-link op-story-handle"
        aria-label={`Open @${row.handle} in chat`}
        onClick={() => onOpenChat(row.conversationId)}
      >
        @{row.handle}
      </button>
      <span className="op-story-title">{row.title}</span>
      {row.order && <span className="op-story-order">{row.order}</span>}
      <span className={`op-state ${row.state ?? 'sent'}`}>{row.stateLabel}</span>
      {row.pull && <PrChip pull={row.pull} />}
      {row.note && <p className="op-story-note">{row.note}</p>}
      {row.warnings.map((warning) => (
        <p key={warning.kind} className="op-story-note warn">
          <InfoIcon />
          <span>{warning.text}</span>
          {warning.fill && (
            <button
              type="button"
              className="op-link"
              onClick={() => warning.fill && onFill(warning.fill.text)}
            >
              {warning.fill.label}
            </button>
          )}
        </p>
      ))}
    </li>
  );
}
