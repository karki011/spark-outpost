import { useRef, useState, type KeyboardEvent } from 'react';
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
    <div className="op-strip-wrap">
      <div
        ref={stripRef}
        className="op-strip"
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
            title={`Open ${memberDetails(member)}`}
            onFocus={() => setFocused(index)}
            onClick={() => onOpen(member.conversationId)}
          >
            <span className="op-member-top">
              <b>@{member.handle}</b>
              <span className={`op-member-state ${member.state}`}>{member.stateLabel}</span>
            </span>
            <small>{member.place || member.title}</small>
            <span className="sr-only">
              {member.place ? `, ${member.title}` : ''}
              {member.agent ? `, ${member.agent}` : ''}, open chat
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
