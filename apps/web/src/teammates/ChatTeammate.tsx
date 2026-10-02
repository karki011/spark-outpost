import type { ConversationSummary, TeammateState } from '@spark-outpost/contracts';
import { TeammateFace } from './TeammateFace.tsx';

function chatState(chat: ConversationSummary): TeammateState {
  if (chat.needsInput) return 'needs_you';
  const status = chat.latestRun?.status;
  if (status === 'queued' || status === 'running') return 'working';
  if (status === 'failed' || status === 'outcome_unknown') return 'failed';
  return 'idle';
}

export function ChatTeammate({ chat }: { chat: ConversationSummary }) {
  const { teammate } = chat;
  if (!teammate) return null;
  return (
    <span
      className="tm-head"
      title={teammate.role ? `${teammate.name} · ${teammate.role}` : teammate.name}
    >
      <TeammateFace face={teammate.face} size={24} state={chatState(chat)} />
      <span className="tm-head-name">
        {chat.title === teammate.name ? teammate.role || 'Spark' : teammate.name}
      </span>
    </span>
  );
}
