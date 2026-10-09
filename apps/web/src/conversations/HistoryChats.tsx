import type { ReactNode } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { FoldSection } from './FoldSection.tsx';
import { historyGroups } from './sidebar-groups.ts';
import type { SidebarFolds } from './use-sidebar-folds.ts';

interface HistoryChatsProps {
  chats: readonly ConversationSummary[];
  search: string | null;
  folds: SidebarFolds;
  renderRow: (chat: ConversationSummary, sortable: boolean, index: number) => ReactNode;
}

export function HistoryChats({ chats, search, folds, renderRow }: HistoryChatsProps) {
  const groups = historyGroups(chats);
  if (groups.length === 0) {
    return (
      <p className="pempty wide">
        {search !== null
          ? `No archived chats match “${search}”.`
          : 'Nothing archived. Archive a chat from its menu and it moves here.'}
      </p>
    );
  }
  return groups.map((group) => {
    const key = `section:history:${group.label}`;
    return (
      <FoldSection
        key={group.label}
        label={group.label}
        open={search !== null || folds.isOpen(key)}
        onToggle={() => folds.toggle(key)}
      >
        <ul className="rows">{group.chats.map((chat, index) => renderRow(chat, false, index))}</ul>
      </FoldSection>
    );
  });
}
