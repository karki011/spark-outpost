import type { ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { FoldSection } from './FoldSection.tsx';
import { looseBuckets } from './sidebar-groups.ts';
import { NO_PROJECT } from './use-chat-drag.ts';
import type { SidebarFolds } from './use-sidebar-folds.ts';

interface LooseChatsProps {
  chats: readonly ConversationSummary[];
  empty: string;
  searching: boolean;
  over: boolean;
  folds: SidebarFolds;
  renderRows: (rows: readonly ConversationSummary[]) => ReactNode;
}

export function LooseChats({ chats, empty, searching, over, folds, renderRows }: LooseChatsProps) {
  const pinned = chats.filter((chat) => chat.pinnedAt);
  return (
    <div
      role="group"
      aria-label="Chats"
      className={`cblock${over ? ' over' : ''}`}
      data-drop={NO_PROJECT}
    >
      <hr className="chats-rule" />
      {chats.length === 0 && <p className="pempty wide">{empty}</p>}
      {pinned.length > 0 && renderRows(pinned)}
      {looseBuckets(chats).map((bucket) => {
        const key = `section:chats:${bucket.label}`;
        return (
          <FoldSection
            key={bucket.label}
            label={bucket.label}
            bucket
            open={searching || folds.isOpen(key)}
            onToggle={() => folds.toggle(key)}
          >
            {renderRows(bucket.chats)}
          </FoldSection>
        );
      })}
    </div>
  );
}
