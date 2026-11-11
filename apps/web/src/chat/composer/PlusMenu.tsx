import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { usePopover } from '../../ui/use-popover.ts';
import {
  SCREENSHOT_FALLBACK,
  canCaptureScreen,
  captureScreenshot,
} from '../attachments/capture-screenshot.ts';
import { ChatPicker } from './ChatPicker.tsx';

interface PlusMenuProps {
  hasProject: boolean;
  onAttach: (files: File[]) => void;
  onNotice: (message: string) => void;
  onAddFromRepo: () => void;
  onAddRepo: () => void;
  chatId: string;
  onAddChat: (chatId: string) => void;
  formatting: boolean;
  onFormatting: () => void;
}

type MenuAction = 'upload' | 'screenshot' | 'repo' | 'add-repo' | 'chat';

const ITEMS: { label: string; icon: ReactNode; action: MenuAction }[] = [
  { label: 'Upload a file', icon: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />, action: 'upload' },
  {
    label: 'Add a screenshot',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    action: 'screenshot',
  },
  { label: 'Add from repo', icon: <path d="M4 6h16M4 12h10M4 18h6" />, action: 'repo' },
  {
    label: 'Add a repo…',
    icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    action: 'add-repo',
  },
  {
    label: 'Add another chat…',
    icon: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
    action: 'chat',
  },
];

export function PlusMenu({
  hasProject,
  onAttach,
  onNotice,
  onAddFromRepo,
  onAddRepo,
  chatId,
  onAddChat,
  formatting,
  onFormatting,
}: PlusMenuProps) {
  const { open, toggle, setOpen, anchorRef, panelRef } = usePopover<
    HTMLButtonElement,
    HTMLDivElement
  >();
  const menuId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pickingChat, setPickingChat] = useState(false);
  const closeChatPicker = useCallback(() => {
    setPickingChat(false);
    anchorRef.current?.focus();
  }, [anchorRef]);

  const addScreenshot = () => {
    if (!canCaptureScreen()) {
      onNotice(SCREENSHOT_FALLBACK);
      return;
    }
    captureScreenshot().then(
      (file) => onAttach([file]),
      () => onNotice('No screenshot was taken. You can also paste one with ⌘V.'),
    );
  };

  const select = (action: MenuAction) => {
    setOpen(false);
    if (action === 'upload') fileInput.current?.click();
    else if (action === 'screenshot') addScreenshot();
    else if (action === 'chat') setPickingChat(true);
    else if (action === 'repo' && hasProject) onAddFromRepo();
    else onAddRepo();
  };

  return (
    <div className="plus-wrap">
      <button
        ref={anchorRef}
        type="button"
        className="icon-btn attach"
        aria-label="Add files and context"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 5v14M5 12h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        aria-label="Upload a file"
        onChange={(event) => {
          onAttach(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      {pickingChat && (
        <ChatPicker currentId={chatId} onPick={onAddChat} onClose={closeChatPicker} />
      )}
      <div
        ref={panelRef}
        id={menuId}
        className={open ? 'mpop left open' : 'mpop left'}
        role="menu"
        aria-label="Add files and context"
      >
        {ITEMS.map((item) => {
          const needsFolder = item.action === 'repo' && !hasProject;
          return (
            <button
              key={item.label}
              type="button"
              className="mopt"
              role="menuitem"
              onClick={() => select(item.action)}
            >
              <span className="mi">
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {item.icon}
                </svg>
              </span>
              <span>
                <b>{item.label}</b>
                {needsFolder && <small>Add a repo first</small>}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          className="mopt"
          role="menuitemcheckbox"
          aria-checked={formatting}
          onClick={() => {
            setOpen(false);
            onFormatting();
          }}
        >
          <span className="mi" aria-hidden="true">
            Aa
          </span>
          <span>
            <b>Formatting</b>
            <small>Show the formatting toolbar</small>
          </span>
        </button>
      </div>
    </div>
  );
}
