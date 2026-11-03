import { useId } from 'react';
import type { Approval } from '@spark-outpost/contracts';
import { queueOption } from '../composer/pending-draft.ts';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import './reply-options.css';

interface ReplyOptionsProps {
  conversationId: string;
  options: readonly string[];
}

export function askedQuestions(approvals: readonly Approval[]): boolean {
  return approvals.some(
    (approval) => isCheckpoint(approval) && approval.payload.checkpoint.kind === 'clarify',
  );
}

export function ReplyOptions({ conversationId, options }: ReplyOptionsProps) {
  const labelId = useId();
  const hintId = useId();
  if (options.length === 0) return null;
  return (
    <div className="reply-options" role="group" aria-labelledby={labelId} aria-describedby={hintId}>
      <span id={labelId} className="reply-options-label">
        Reply with
      </span>
      <span id={hintId} className="sr-only">
        Puts the choice in the message box. Nothing is sent until you press Enter.
      </span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="btn line sm reply-option"
          onClick={() => queueOption(conversationId, option, options)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
