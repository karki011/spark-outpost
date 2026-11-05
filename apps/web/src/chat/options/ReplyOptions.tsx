import { useId } from 'react';
import type { Approval } from '@spark-outpost/contracts';
import { queueOption } from '../composer/pending-draft.ts';
import { isCheckpoint } from '../checkpoints/checkpoint-model.ts';
import { Markdown } from '../markdown/Markdown.tsx';
import { withoutOptionList } from './reply-options.ts';
import { setShownAsList, useShownAsList } from './shown-as-list.ts';
import './reply-options.css';

interface OptionReplyProps {
  text: string;
  options: readonly string[];
  runId: string;
  conversationId: string;
}

export function askedQuestions(approvals: readonly Approval[]): boolean {
  return approvals.some(
    (approval) => isCheckpoint(approval) && approval.payload.checkpoint.kind === 'clarify',
  );
}

function OptionButtons({ options, conversationId }: Omit<OptionReplyProps, 'text' | 'runId'>) {
  const hintId = useId();
  return (
    <div
      className="reply-options"
      role="group"
      aria-label="Reply options"
      aria-describedby={hintId}
    >
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

export function OptionReply({ text, options, runId, conversationId }: OptionReplyProps) {
  const asList = useShownAsList(runId);
  return (
    <>
      <Markdown text={asList ? text : withoutOptionList(text)} />
      {!asList && <OptionButtons options={options} conversationId={conversationId} />}
      <button
        type="button"
        className="reply-options-toggle"
        onClick={() => setShownAsList(runId, !asList)}
      >
        {asList ? 'Show as buttons' : 'Show as list'}
      </button>
    </>
  );
}
