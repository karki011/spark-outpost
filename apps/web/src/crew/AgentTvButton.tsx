import './agent-tv.css';
import { closeAgentTv, openAgentTv, useAgentTv } from './agent-tv-store.ts';
import { TV_BUTTON_ID } from './AgentTv.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { busyCount, type CrewAgent } from './crew-model.ts';

interface AgentTvButtonProps {
  conversationId: string;
  agents: readonly CrewAgent[];
}

export function AgentTvButton({ conversationId, agents }: AgentTvButtonProps) {
  const tv = useAgentTv();
  const busy = busyCount(agents);
  const tip = useTooltip(
    busy > 0 ? `Agent TV · ${busy} ${busy === 1 ? 'agent' : 'agents'} working` : 'Agent TV',
  );
  if (agents.length === 0) return null;
  const open = tv.sourceId === conversationId;
  return (
    <>
      <button
        type="button"
        id={TV_BUTTON_ID}
        className={busy > 0 ? 'icon-btn tv-btn live' : 'icon-btn tv-btn'}
        aria-pressed={open}
        aria-label="Agent TV"
        {...tip.triggerProps}
        onClick={() => (open ? closeAgentTv() : openAgentTv(conversationId))}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="7" width="18" height="13" rx="3" />
          <path d="m8 3 4 4 4-4" />
        </svg>
        <i className="live" aria-hidden="true" />
      </button>
      {tip.tooltip}
    </>
  );
}
