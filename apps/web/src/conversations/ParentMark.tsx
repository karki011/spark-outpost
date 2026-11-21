import './sub-chat-rows.css';
import type { ConversationSummary } from '@spark-outpost/contracts';

type Marked = Pick<ConversationSummary, 'parent' | 'formerParent'>;

export function ParentMark({ chat }: { chat: Marked }) {
  if (chat.parent) {
    return (
      <span className="parent-mark" data-mark="parent">
        <span aria-hidden="true">↳ </span>
        <span className="sr-only">, sub-chat of </span>
        {chat.parent.title}
      </span>
    );
  }
  if (chat.formerParent) {
    return (
      <span className="parent-mark" data-mark="former">
        <span aria-hidden="true">· </span>
        <span className="sr-only">, </span>
        was part of {chat.formerParent.title}
      </span>
    );
  }
  return null;
}
