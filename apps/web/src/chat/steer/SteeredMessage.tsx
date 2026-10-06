import './steer.css';
import type { ConversationDetail, MemberMessage, Run } from '@spark-outpost/contracts';
import { MessageActions } from '../message-actions/MessageActions.tsx';
import { QuotedText } from '../quotes/QuotedText.tsx';
import { steerAnchor, steerStatus, turnSteers } from './steer-model.ts';

interface SteeredMessageProps {
  message: MemberMessage;
  detail: ConversationDetail;
  run: Run;
  crew: boolean;
}

export function SteeredMessage({ message, detail, run, crew }: SteeredMessageProps) {
  const status = steerStatus(message, detail, run, crew);
  return (
    <div
      id={steerAnchor(message.id)}
      className={`msg me steered ${status.tone}`}
      data-message-id={message.id}
      data-steer={message.status}
    >
      <div className="bubble">
        <QuotedText text={message.body} />
      </div>
      <p className="steer-status" role="status" aria-live="polite">
        {status.text}
      </p>
      <MessageActions
        text={message.body}
        createdAt={message.createdAt}
        copyLabel="Copy message"
        side="user"
      />
    </div>
  );
}

interface TurnSteersProps {
  detail: ConversationDetail;
  run: Run;
}

export function TurnSteers({ detail, run }: TurnSteersProps) {
  return turnSteers(detail, run.id).map((message) => (
    <SteeredMessage key={message.id} message={message} detail={detail} run={run} crew={false} />
  ));
}
