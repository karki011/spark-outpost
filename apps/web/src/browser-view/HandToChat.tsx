import '../conversations/chat-menu.css';
import { useRef, useState } from 'react';
import type { BrowserPaneTab, BrowserProfile, ConversationSummary } from '@spark-outpost/contracts';
import { MenuItem, MenuShell, type MenuAnchor } from '../conversations/MenuShell.tsx';
import { CommentIcon, HandOffIcon } from '../ui/icons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { handTabToChat } from './view-store.ts';

const CHATS_SHOWN = 8;

interface HandToChatProps {
  profile: BrowserProfile;
  tab: BrowserPaneTab | null;
  chats: readonly ConversationSummary[];
  onHanded(chatId: string): void;
  onProblem(reason: string): void;
}

function handTargets(chats: readonly ConversationSummary[]): ConversationSummary[] {
  return [...chats]
    .filter((chat) => chat.archivedAt === null && chat.assistant !== true)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, CHATS_SHOWN);
}

const HINTS: Record<BrowserProfile, string> = {
  work: 'Hand this tab to a chat: it moves there as your tab',
  personal: 'Hand to a chat: only this address goes, opened in a Work tab',
};

export function HandToChat({ profile, tab, chats, onHanded, onProblem }: HandToChatProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const tip = useTooltip(HINTS[profile], { side: 'bottom' });
  const page = tab !== null && tab.url !== '' && tab.error === null;
  const targets = handTargets(chats);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ x: rect.left, y: rect.bottom + 4, above: rect.top - 4, focusBack: button.current });
  };
  const close = () => {
    setAnchor(null);
    button.current?.focus();
  };
  const hand = async (chatId: string) => {
    if (!tab) return;
    setAnchor(null);
    const result = await handTabToChat(profile, tab.id, chatId);
    if (result.ok) onHanded(chatId);
    else onProblem(result.reason);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn bv-hand"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={!page}
        {...tip.triggerProps}
        onClick={() => (anchor ? close() : open())}
      >
        <HandOffIcon />
        Hand to chat
      </button>
      {tip.tooltip}
      {anchor && (
        <MenuShell anchor={anchor} label="Hand this tab to a chat" page="main" onClose={close}>
          {targets.length === 0 && (
            <MenuItem label="No chats yet" disabled onSelect={() => undefined} />
          )}
          {targets.map((chat) => (
            <MenuItem
              key={chat.id}
              icon={<CommentIcon />}
              label={chat.title.trim() || 'New chat'}
              onSelect={() => void hand(chat.id)}
            />
          ))}
        </MenuShell>
      )}
    </>
  );
}
