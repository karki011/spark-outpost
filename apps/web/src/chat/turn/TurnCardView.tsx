import type { Project } from '@spark-outpost/contracts';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { FlagLine } from '../approvals/RailFlags.tsx';
import { CheckpointCard } from '../checkpoints/CheckpointCard.tsx';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import type { TurnCard } from './turn-cards.ts';

interface TurnCardViewProps {
  card: TurnCard;
  provider: string;
  repo: Project | null;
  conversationId: string;
}

export function TurnCardView({ card, provider, repo, conversationId }: TurnCardViewProps) {
  if (card.kind === 'flag') return <FlagLine flag={card.flag} conversationId={conversationId} />;
  if (isCheckpoint(card.approval)) return <CheckpointCard approval={card.approval} />;
  return <ApprovalCard approval={card.approval} provider={provider} repo={repo} />;
}
