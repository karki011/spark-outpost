import { useRef, useState, type KeyboardEvent } from 'react';
import { MemberFace } from './MemberFace.tsx';
import { memberDetails, type MemberView } from './member-view.ts';

interface MemberStripProps {
  members: readonly MemberView[];
  onOpen: (conversationId: string) => void;
}

function nextIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export function MemberStrip({ members, onOpen }: MemberStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(0);
  const current = Math.min(focused, members.length - 1);
  if (members.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextIndex(event.key, current, members.length);
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    stripRef.current?.querySelectorAll<HTMLButtonElement>('.op-member')[next]?.focus();
  };

  return (
    <div
      ref={stripRef}
      className="op-stack"
      role="toolbar"
      aria-label="Chats in this outpost"
      onKeyDown={onKeyDown}
    >
      {members.map((member, index) => (
        <button
          key={member.conversationId}
          type="button"
          className={member.archived ? 'op-member dim' : 'op-member'}
          tabIndex={index === current ? 0 : -1}
          title={`@${member.handle} · ${member.stateLabel} · ${memberDetails(member)}`}
          onFocus={() => setFocused(index)}
          onClick={() => onOpen(member.conversationId)}
        >
          <MemberFace chatId={member.conversationId} state={member.state} size="post" />
          <i className={`op-dot ${member.state}`} aria-hidden="true" />
          <span className="sr-only">
            @{member.handle}, {member.stateLabel}
            {member.title ? `, ${member.title}` : ''}, open chat
          </span>
        </button>
      ))}
    </div>
  );
}
