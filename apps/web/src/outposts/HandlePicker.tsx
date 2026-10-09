import '../chat/composer/composer-popovers.css';
import '../chat/project/project.css';
import type { MemberView } from './member-view.ts';

interface HandlePickerProps {
  listId: string;
  options: readonly MemberView[];
  active: number;
  onActive: (index: number) => void;
  onPick: (member: MemberView) => void;
}

export function handleOptionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

export function HandlePicker({ listId, options, active, onActive, onPick }: HandlePickerProps) {
  return (
    <div className="mpop left open op-handles">
      <p className="op-handles-title" aria-hidden="true">
        Address a chat
      </p>
      <div id={listId} className="flist" role="listbox" aria-label="Chats in this outpost">
        {options.map((member, index) => (
          <div
            key={member.conversationId}
            id={handleOptionId(listId, index)}
            className="fopt op-handle"
            role="option"
            aria-selected={index === active}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => {
              if (index !== active) onActive(index);
            }}
            onClick={() => onPick(member)}
          >
            <b>@{member.handle}</b>
            <small>{member.title}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
