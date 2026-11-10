import type { ConversationSummary } from '@spark-outpost/contracts';
import { HomeRow, HomeRows, RowAction, StatusLabel } from './HomeCards.tsx';
import type { NeedItem, RunItem } from './home-model.ts';

type OpenChat = (chat: ConversationSummary) => void;

export function WaitingRows({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: readonly NeedItem[];
  onOpen: OpenChat;
}) {
  return (
    <HomeRows label={label}>
      {items.map((item, index) => (
        <HomeRow
          key={item.chat.id}
          index={index}
          label={<StatusLabel word="Waiting" tone="warn" />}
          title={item.chat.title}
          line={item.sub}
          trailing={
            <RowAction
              label="Open chat"
              name={`Open chat: ${item.chat.title}`}
              primary
              onClick={() => onOpen(item.chat)}
            />
          }
        />
      ))}
    </HomeRows>
  );
}

export function RunRows({
  label,
  items,
  onOpen,
}: {
  label: string;
  items: readonly RunItem[];
  onOpen: OpenChat;
}) {
  return (
    <HomeRows label={label}>
      {items.map((item, index) => (
        <HomeRow
          key={item.chat.id}
          index={index}
          label={<StatusLabel word="Running" tone="run" />}
          title={item.chat.title}
          line={item.step}
          trailing={
            <RowAction
              label="Open chat"
              name={`Open chat: ${item.chat.title}`}
              onClick={() => onOpen(item.chat)}
            />
          }
        />
      ))}
    </HomeRows>
  );
}
