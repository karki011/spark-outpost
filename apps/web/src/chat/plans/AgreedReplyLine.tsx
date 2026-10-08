import './save-plan.css';
import type { ConversationDetail, Message } from '@spark-outpost/contracts';
import { CheckIcon } from '../../ui/icons.tsx';

interface AgreedReplyLineProps {
  detail: ConversationDetail;
  message: Message | null | undefined;
  finished: boolean;
}

export function AgreedReplyLine({ detail, message, finished }: AgreedReplyLineProps) {
  if (!finished || !message) return null;
  const saved = detail.plans?.saved.find((candidate) => candidate.messageId === message.id);
  if (!saved) return null;
  return (
    <p className="saveplan saved" role="status">
      <CheckIcon />
      Agreed plan v{saved.version}
    </p>
  );
}
