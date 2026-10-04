import type { ConversationSummary, TicketStatus } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { useReducedMotion } from '../ui/motion.ts';
import { Glyph } from './ticket-icons.tsx';
import { statusBadge } from './ticket-status.ts';

const FACE_SIZE = 16;

export function SparkFace({ chat }: { chat: ConversationSummary | null }) {
  const reduced = useReducedMotion();
  if (chat?.teammate) {
    return <TeammateFace face={chat.teammate.face} size={FACE_SIZE} state="working" />;
  }
  const provider = chat?.latestRun?.provider;
  if (!provider) return <i className="sev run" aria-hidden="true" />;
  return <AgentBlob provider={provider} size={FACE_SIZE} animate={reduced ? 'hover' : 'always'} />;
}

export function StatusBadge({ status, name }: { status: TicketStatus; name: string }) {
  const badge = statusBadge(status, name);
  return (
    <span className={`fchip ${badge.category}`} title={badge.label}>
      <Glyph name={badge.glyph} size={12} />
      <span className="fchip-l">{badge.label}</span>
    </span>
  );
}
