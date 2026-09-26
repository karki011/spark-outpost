import type { ReactNode } from 'react';
import { SortableContext } from '@dnd-kit/sortable';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { listSorting, noSorting } from './sidebar-dnd-geometry.ts';

interface ChatRowsProps {
  id: string;
  chats: readonly ConversationSummary[];
  sortable?: boolean;
  renderRow: (chat: ConversationSummary) => ReactNode;
}

export function ChatRows({ id, chats, sortable = true, renderRow }: ChatRowsProps) {
  if (chats.length === 0) return null;
  return (
    <SortableContext
      id={id}
      items={chats.map((chat) => chat.id)}
      strategy={sortable ? listSorting : noSorting}
    >
      <ul className="rows">{chats.map((chat) => renderRow(chat))}</ul>
    </SortableContext>
  );
}
