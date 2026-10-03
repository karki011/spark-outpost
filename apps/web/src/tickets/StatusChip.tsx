import type { ConversationSummary, TicketSection } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { TeammateFace } from '../teammates/TeammateFace.tsx';
import { useReducedMotion } from '../ui/motion.ts';
import { flowChip, type ChipTone } from './ticket-flow.ts';
import { Glyph, type GlyphName } from './ticket-icons.tsx';
import type { RowTone } from './TicketRow.tsx';

export const CHIP_GLYPHS: Record<ChipTone, GlyphName> = {
  needs: 'warn',
  bad: 'x-circle',
  spark: 'chat',
  started: 'play',
  next: 'circle',
  review: 'pr',
  done: 'check',
};

const FACE_SIZE = 16;

function SparkFace({ chat }: { chat: ConversationSummary | null }) {
  const reduced = useReducedMotion();
  if (chat?.teammate) {
    return <TeammateFace face={chat.teammate.face} size={FACE_SIZE} state="working" />;
  }
  const provider = chat?.latestRun?.provider;
  if (!provider) return <Glyph name="chat" size={12} />;
  return <AgentBlob provider={provider} size={FACE_SIZE} animate={reduced ? 'hover' : 'always'} />;
}

interface StatusChipProps {
  section: TicketSection;
  tone: RowTone;
  chat: ConversationSummary | null;
}

export function StatusChip({ section, tone, chat }: StatusChipProps) {
  const chip = flowChip(section, tone);
  return (
    <span className={`fchip ${chip.tone}`}>
      {chip.tone === 'spark' ? (
        <SparkFace chat={chat} />
      ) : (
        <Glyph name={CHIP_GLYPHS[chip.tone]} size={12} />
      )}
      <span className="fchip-l">{chip.label}</span>
    </span>
  );
}
