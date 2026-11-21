import type { ReactNode } from 'react';
import { SortableContext } from '@dnd-kit/sortable';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { listSorting, noSorting } from './sidebar-dnd-geometry.ts';

interface ChatRowsProps {
  id: string;
  chats: readonly ConversationSummary[];
  sortable?: boolean;
  nestedLabel?: string | undefined;
  renderRow: (chat: ConversationSummary, index: number) => ReactNode;
}

export function ChatRows({ id, chats, sortable = true, nestedLabel, renderRow }: ChatRowsProps) {
  if (chats.length === 0) return null;
  return (
    <SortableContext
      id={id}
      items={chats.map((chat) => chat.id)}
      strategy={sortable ? listSorting : noSorting}
    >
      <ul className={nestedLabel ? 'rows sub-rows' : 'rows'} aria-label={nestedLabel}>
        {chats.map((chat, index) => renderRow(chat, index))}
      </ul>
    </SortableContext>
  );
}
