import type { MemberMessage } from '@spark-outpost/contracts';
import { messageState, messageTone } from './member-model.ts';

interface MemberMessageListProps {
  name: string;
  live: boolean;
  messages: readonly MemberMessage[];
  className?: string;
}

export function MemberMessageList({
  name,
  live,
  messages,
  className = 'mc-log',
}: MemberMessageListProps) {
  if (messages.length === 0) return null;
  return (
    <ol className={className} aria-label={`Your messages to ${name}`}>
      {messages.map((message) => (
        <li key={message.id}>
          <span className="mc-you">You → {name}</span>
          <p>{message.body}</p>
          <small className={`mc-st ${messageTone(message, live)}`}>
            {messageState(message, live, name)}
          </small>
        </li>
      ))}
    </ol>
  );
}
