import type { ChatMenuPane } from '../audit/ChatHeaderMenu.tsx';
import { closeAgentTv, openAgentTv } from './agent-tv-store.ts';
import { busyCount, type CrewAgent } from './crew-model.ts';
import { TvIcon } from './tv-icons.tsx';

export function tvMenuPane(
  conversationId: string,
  agents: readonly CrewAgent[],
  watchedId: string | null,
): ChatMenuPane | null {
  if (agents.length === 0) return null;
  const open = watchedId === conversationId;
  const busy = busyCount(agents);
  return {
    label: 'Agent TV',
    icon: <TvIcon />,
    open,
    signal:
      busy > 0
        ? {
            note: `${busy} working`,
            summary: `${busy} ${busy === 1 ? 'agent' : 'agents'} working`,
            live: true,
          }
        : null,
    onToggle: () => (open ? closeAgentTv() : openAgentTv(conversationId)),
  };
}
