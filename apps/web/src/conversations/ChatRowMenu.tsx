import type { ConversationSummary, Project } from '@spark-outpost/contracts';
import { useOutpostSeam } from '../chat/outpost/outpost-seam.ts';
import { ChatMenu } from './ChatMenu.tsx';
import type { MenuAnchor } from './MenuShell.tsx';
import { movedOrder, pinnedSiblings } from './sidebar-groups.ts';
import type { ChatActions } from './use-chat-actions.ts';
import type { Toaster } from './use-toast.ts';

interface ChatRowMenuProps {
  chat: ConversationSummary;
  anchor: MenuAnchor;
  chats: readonly ConversationSummary[];
  projects: readonly Project[];
  actions: ChatActions;
  toaster: Toaster;
  onClose: () => void;
  onRename: () => void;
}

export function ChatRowMenu({
  chat,
  anchor,
  chats,
  projects,
  actions,
  toaster,
  onClose,
  onRename,
}: ChatRowMenuProps) {
  const outpostSeam = useOutpostSeam();
  const siblings = chat.pinnedAt && !chat.archivedAt ? pinnedSiblings(chats, chat) : [];
  const moveUp = movedOrder(siblings, chat.id, -1);
  const moveDown = movedOrder(siblings, chat.id, 1);
  return (
    <ChatMenu
      chat={chat}
      anchor={anchor}
      projects={projects}
      outposts={
        outpostSeam?.canManage
          ? {
              list: outpostSeam.outposts,
              onAdd: (outpostId, handle) =>
                void outpostSeam
                  .onAddToOutpost(outpostId, { conversationId: chat.id, handle })
                  .then(
                    () => toaster.show({ text: `Added ${chat.title} as @${handle}` }),
                    (error: Error) => toaster.show({ text: error.message }),
                  ),
              onNew: () => outpostSeam.onNewOutpost(chat.id),
            }
          : undefined
      }
      onClose={onClose}
      onRename={onRename}
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
