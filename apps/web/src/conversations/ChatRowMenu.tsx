import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import type { PickerAction } from '../ui/ChoicePicker.tsx';
import { ChatMenu } from './ChatMenu.tsx';
import type { MenuAnchor } from './MenuShell.tsx';
import { movedOrder, pinnedSiblings } from './sidebar-groups.ts';
import type { ChatActions } from './use-chat-actions.ts';

interface ChatRowMenuProps {
  chat: ConversationSummary;
  anchor: MenuAnchor;
  chats: readonly ConversationSummary[];
  projects: readonly Project[];
  actions: ChatActions;
  folderActions: readonly PickerAction[];
  onClose: () => void;
  onRename: () => void;
  onOpenBeside: (() => void) | null;
}

export function ChatRowMenu({
  chat,
  anchor,
  chats,
  projects,
  actions,
  folderActions,
  onClose,
  onRename,
  onOpenBeside,
}: ChatRowMenuProps) {
  const pinned = chat.pinnedAt && !chat.archivedAt ? pinnedSiblings(chats, chat) : [];
  const siblings = pinned.includes(chat.id) ? pinned : [];
  const moveUp = movedOrder(siblings, chat.id, -1);
  const moveDown = movedOrder(siblings, chat.id, 1);
  return (
    <ChatMenu
      chat={chat}
      anchor={anchor}
      projects={projects}
      folderActions={folderActions}
      onClose={onClose}
      onRename={onRename}
      onOpenBeside={onOpenBeside}
      onAutoTitle={(on) => actions.setAutoTitle(chat, on)}
      onPin={() => actions.pin(chat)}
      onCopyLink={() => actions.copyLink(chat)}
      {...(siblings.length > 1
        ? {
            onMoveUp: moveUp ? () => actions.reorderPinned(moveUp) : null,
            onMoveDown: moveDown ? () => actions.reorderPinned(moveDown) : null,
          }
        : {})}
      onMove={(projectId) => actions.move(chat, projectId)}
      onArchive={(archived) => actions.archive(chat, archived)}
      onDelete={() => actions.remove(chat)}
    />
  );
}
