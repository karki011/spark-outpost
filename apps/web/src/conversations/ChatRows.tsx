import { useState, type ReactNode } from 'react';
import { Reorder } from 'motion/react';
import type { ConversationSummary } from '@spark-outpost/contracts';

interface ChatRowsProps {
  chats: readonly ConversationSummary[];
  renderRow: (chat: ConversationSummary, onReorderEnd?: () => void) => ReactNode;
  onReorder: (ids: readonly string[]) => void;
}

export function ChatRows({ chats, renderRow, onReorder }: ChatRowsProps) {
  const pinned = chats.filter((chat) => chat.pinnedAt);
  const rest = chats.filter((chat) => !chat.pinnedAt);
  const pinnedIds = pinned.map((chat) => chat.id);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const known =
    dragOrder?.length === pinnedIds.length && dragOrder.every((id) => pinnedIds.includes(id));
  const order = known && dragOrder ? dragOrder : pinnedIds;
  const byId = new Map(pinned.map((chat) => [chat.id, chat]));

  const finish = () => {
    if (known && dragOrder && dragOrder.join() !== pinnedIds.join()) onReorder(dragOrder);
    setDragOrder(null);
  };

  return (
    <>
      {pinned.length > 1 ? (
        <Reorder.Group as="ul" axis="y" className="rows" values={order} onReorder={setDragOrder}>
          {order.map((id) => renderRow(byId.get(id)!, finish))}
        </Reorder.Group>
      ) : (
        pinned.length === 1 && <ul className="rows">{pinned.map((chat) => renderRow(chat))}</ul>
      )}
      {rest.length > 0 && <ul className="rows">{rest.map((chat) => renderRow(chat))}</ul>}
    </>
  );
}
