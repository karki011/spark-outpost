import type { KeyboardEvent, RefObject } from 'react';
import { requestSessionPalette } from '../sessions/palette-request.ts';
import { SessionsIcon, XIcon } from '../ui/icons.tsx';
import { Keys, keysText, NEW_CHAT_KEYS, PALETTE_KEYS, SEARCH_KEYS } from '../ui/Keys.tsx';
import { hasModifier, MAC } from '../ui/shortcuts.ts';
import { useTooltip } from '../ui/Tooltip.tsx';

export type SidebarTab = 'active' | 'history';

export const LIST_PANEL_ID = 'chat-list-panel';
export const SEARCH_DELAY_MS = 180;

export function NewChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      <path d="M13 9v6M10 12h6" />
    </svg>
  );
}

export const NEW_CHAT_HINT = keysText(NEW_CHAT_KEYS);

export function isNewChatShortcut(event: globalThis.KeyboardEvent): boolean {
  return hasModifier(event) && event.shiftKey && event.key.toLowerCase() === 'o';
}

export function NewChatButton({ onNew }: { onNew: () => void }) {
  return (
    <button
      type="button"
      className="side-new"
      aria-label="New chat"
      aria-keyshortcuts={MAC ? 'Meta+Shift+O' : 'Control+Shift+O'}
      title={`New chat (${NEW_CHAT_HINT})`}
      onClick={onNew}
    >
      <NewChatIcon />
      <span>New chat</span>
      <Keys keys={NEW_CHAT_KEYS} className="key-hint" />
    </button>
  );
}

export function SessionsButton() {
  const tip = useTooltip('Sessions', { keys: PALETTE_KEYS });
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Sessions"
        aria-haspopup="dialog"
        aria-keyshortcuts={MAC ? 'Meta+Shift+K' : 'Control+Shift+K'}
        {...tip.triggerProps}
        onClick={requestSessionPalette}
      >
        <SessionsIcon />
      </button>
      {tip.tooltip}
    </>
  );
}

interface SearchBoxProps {
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
}

export function SearchBox({ value, inputRef, onChange }: SearchBoxProps) {
  return (
    <label className="search">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder="Search"
        aria-label="Search chats"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.stopPropagation();
            onChange('');
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <XIcon />
        </button>
      ) : (
        <Keys keys={SEARCH_KEYS} className="key-hint search-key" />
      )}
    </label>
  );
}

interface SidebarTabsProps {
  tab: SidebarTab;
  activeCount: number;
  historyCount: number;
  activeNeedsInput: boolean;
  onTab: (tab: SidebarTab) => void;
}

export function SidebarTabs({
  tab,
  activeCount,
  historyCount,
  activeNeedsInput,
  onTab,
}: SidebarTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'active' ? 'history' : 'active';
    onTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };
  const tabProps = (id: SidebarTab) => ({
    type: 'button' as const,
    role: 'tab',
    'data-tab': id,
    'aria-selected': tab === id,
    'aria-controls': LIST_PANEL_ID,
    tabIndex: tab === id ? 0 : -1,
    onClick: () => onTab(id),
  });
  return (
    <div
      className={`tabs${tab === 'history' ? ' on-history' : ''}`}
      role="tablist"
      aria-label="Chat lists"
      onKeyDown={onKeyDown}
    >
      <span className="tab-ind" aria-hidden="true" />
      <button {...tabProps('active')}>
        Active <span className="cnt">{activeCount || ''}</span>
        {activeNeedsInput && tab !== 'active' && (
          <i className="adot" role="img" aria-label="A chat needs your input" />
        )}
      </button>
      <button {...tabProps('history')}>
        History <span className="cnt">{historyCount || ''}</span>
      </button>
    </div>
  );
}
