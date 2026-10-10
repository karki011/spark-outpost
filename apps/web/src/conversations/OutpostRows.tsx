import './outpost-rows.css';
import type { ReactNode } from 'react';
import type { Outpost } from '@spark-outpost/contracts';
import { PlusIcon } from '../ui/icons.tsx';
import { OutpostGroup } from './OutpostGroup.tsx';
import type { MemberChat, OutpostMembers } from './outpost-members.ts';

const NO_MEMBERS: readonly MemberChat[] = [];

interface OutpostRowsProps {
  outposts: readonly Outpost[];
  members: OutpostMembers;
  openId: string | null;
  isOpen: (outpostId: string) => boolean;
  onToggle: (outpostId: string) => void;
  onOpen: (outpostId: string) => void;
  onNew?: (() => void) | undefined;
  renderMembers: (outpostId: string, members: readonly MemberChat[]) => ReactNode;
}

export function OutpostRows({
  outposts,
  members,
  openId,
  isOpen,
  onToggle,
  onOpen,
  onNew,
  renderMembers,
}: OutpostRowsProps) {
  return (
    <section aria-label="Outposts">
      <div className="sec">
        <span>Outposts</span>
        {onNew && (
          <button
            type="button"
            className="icon-btn"
            aria-label="New outpost"
            title="New outpost"
            onClick={onNew}
          >
            <PlusIcon />
          </button>
        )}
      </div>
      {outposts.length > 0 && (
        <ul className="rows">
          {outposts.map((outpost) => {
            const listed = members.get(outpost.id) ?? NO_MEMBERS;
            return (
              <OutpostGroup
                key={outpost.id}
                outpost={outpost}
                current={outpost.id === openId}
                open={isOpen(outpost.id)}
                count={listed.length}
                onOpen={() => onOpen(outpost.id)}
                onToggle={() => onToggle(outpost.id)}
              >
                {renderMembers(outpost.id, listed)}
              </OutpostGroup>
            );
          })}
        </ul>
      )}
    </section>
  );
}
