import {
  looksLikePlan,
  type Category,
  type ConversationDetail,
  type Message,
} from '@spark-outpost/contracts';
import { SavePlan } from './SavePlan.tsx';

interface TurnPlanOfferProps {
  detail: ConversationDetail;
  runId: string;
}

export function TurnPlanOffer({ detail, runId }: TurnPlanOfferProps) {
  const offer = detail.plans?.offers.find((candidate) => candidate.runId === runId);
  if (!offer) return null;
  return (
    <SavePlan
      conversationId={detail.conversation.id}
      messageId={offer.messageId}
      savedVersion={null}
      offered
    />
  );
}

interface ReplyPlanActionProps {
  detail: ConversationDetail;
  message: Message | null | undefined;
  finished: boolean;
  category: Category | null | undefined;
}

export function ReplyPlanAction({ detail, message, finished, category }: ReplyPlanActionProps) {
  if (!finished || !message) return null;
  const savedVersion =
    detail.plans?.saved.find((saved) => saved.messageId === message.id)?.version ?? null;
  if (savedVersion === null && !looksLikePlan(message.content, category)) return null;
  return (
    <SavePlan
      conversationId={detail.conversation.id}
      messageId={message.id}
      savedVersion={savedVersion}
    />
  );
}
