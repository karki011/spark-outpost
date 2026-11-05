import type {
  ConversationSummary,
  PullRequestChecks,
  TicketStatus,
} from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { useReducedMotion } from '../ui/motion.ts';
import { Glyph, type GlyphName } from './ticket-icons.tsx';
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

const CHECKS: Record<PullRequestChecks, { label: string; tone: string; glyph: GlyphName }> = {
  failing: { label: 'Checks failing', tone: 'blocked', glyph: 'x-circle' },
  pending: { label: 'Checks running', tone: 'todo', glyph: 'clock' },
  passing: { label: 'Checks passing', tone: 'done', glyph: 'check' },
};

export function ChecksBadge({ checks, unseen }: { checks: PullRequestChecks; unseen?: boolean }) {
  const badge = CHECKS[checks];
  return (
    <span className={`fchip ci ${badge.tone}${unseen ? ' unseen' : ''}`} title={badge.label}>
      <Glyph name={badge.glyph} size={12} />
      <span className="fchip-l">{badge.label}</span>
      {unseen && <span className="sr-only">, new</span>}
    </span>
  );
}
