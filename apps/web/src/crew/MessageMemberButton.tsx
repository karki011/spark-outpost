import { CommentIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import type { CrewAgent } from './crew-model.ts';
import { openMemberChat } from './member-chat-store.ts';
import { messageable } from './member-model.ts';

interface MessageMemberButtonProps {
  conversationId: string;
  agent: CrewAgent;
  className?: string;
}

export function MessageMemberButton({
  conversationId,
  agent,
  className = 'icon-btn',
}: MessageMemberButtonProps) {
  const { id: runId, name } = agent;
  const tip = useTooltip(`Message ${name}`);
  if (!messageable(agent)) return null;
  return (
    <>
      <button
        type="button"
        className={`${className} msg-member`}
        aria-label={`Message ${name}`}
        {...tip.triggerProps}
        onClick={() => openMemberChat(conversationId, runId)}
      >
        <CommentIcon />
      </button>
      {tip.tooltip}
    </>
  );
}
