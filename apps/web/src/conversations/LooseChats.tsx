import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { FoldSection } from './FoldSection.tsx';
import { looseBuckets } from './sidebar-groups.ts';
import { LOOSE_DROP_ID } from './sidebar-dnd-geometry.ts';
import { LOOSE, pinnedIn, NO_PROJECT } from './sidebar-order.ts';
import type { SidebarFolds } from './use-sidebar-folds.ts';

type RenderRows = (
  id: string,
  rows: readonly ConversationSummary[],
  options: { sortable: boolean; enabled: boolean },
) => ReactNode;

interface LooseChatsProps {
  pinned: readonly ConversationSummary[];
  unpinned: readonly ConversationSummary[];
  empty: string;
  searching: boolean;
  over: boolean;
  folds: SidebarFolds;
  renderRows: RenderRows;
}

export function LooseChats({
  pinned,
  unpinned,
  empty,
  searching,
  over,
  folds,
  renderRows,
}: LooseChatsProps) {
  const { setNodeRef } = useDroppable({ id: LOOSE_DROP_ID, data: { type: 'loose' } });
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label="Chats"
      className={`cblock${over ? ' over' : ''}`}
    >
      <hr className="chats-rule" />
      {pinned.length + unpinned.length === 0 && <p className="pempty wide">{empty}</p>}
      {renderRows(pinnedIn(NO_PROJECT), pinned, { sortable: true, enabled: true })}
      {looseBuckets(unpinned).map((bucket) => {
        const key = `section:chats:${bucket.label}`;
        const open = searching || folds.isOpen(key);
        return (
          <FoldSection
            key={bucket.label}
            label={bucket.label}
            bucket
            open={open}
            onToggle={() => folds.toggle(key)}
          >
            {renderRows(`${LOOSE}:${bucket.label}`, bucket.chats, {
              sortable: false,
              enabled: open,
            })}
          </FoldSection>
        );
      })}
    </div>
  );
}
