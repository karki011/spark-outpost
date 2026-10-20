import { useEffect, useRef, useState } from 'react';
import { BROWSER_FIND_MAX, browserFoundSchema, type BrowserFound } from '@spark-outpost/contracts';
import { desktopBrowser } from '../desktop/desktop-bridge.ts';
import { CloseIcon } from '../tasks/TaskIcons.tsx';
import { ArrowDownIcon, ArrowUpIcon } from '../ui/icons.tsx';
import { sendBrowserCommand } from './browser-store.ts';

interface FindBarProps {
  chatId: string;
  tabId: string;
  request: number;
  onClose(): void;
}

function useFound(chatId: string, tabId: string): BrowserFound | null {
  const [found, setFound] = useState<BrowserFound | null>(null);
  useEffect(() => {
    const browser = desktopBrowser();
    if (!browser) return;
    return browser.onFound((raw) => {
      const result = browserFoundSchema.safeParse(raw);
      if (result.success && result.data.chatId === chatId && result.data.tabId === tabId) {
        setFound(result.data);
      }
    });
  }, [chatId, tabId]);
  return found;
}

function countLabel(text: string, found: BrowserFound | null): string {
  if (text === '' || found === null) return '';
  if (found.matches === 0) return 'No matches';
  return `${found.active} of ${found.matches}`;
}

export function FindBar({ chatId, tabId, request, onClose }: FindBarProps) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const found = useFound(chatId, tabId);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [request]);

  useEffect(() => () => sendBrowserCommand(chatId, { command: 'stop_find', tabId }), [chatId, tabId]);

  const find = (value: string, forward: boolean, next: boolean) => {
    if (value === '') sendBrowserCommand(chatId, { command: 'stop_find', tabId });
    else sendBrowserCommand(chatId, { command: 'find', tabId, text: value, forward, next });
  };

  return (
    <div className="bp-find" role="search" aria-label="Find in page">
      <input
        ref={input}
        className="inp bp-find-input"
        type="search"
        aria-label="Find in page"
        placeholder="Find in page"
        maxLength={BROWSER_FIND_MAX}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          find(event.target.value, true, false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            find(text, !event.shiftKey, true);
          }
        }}
      />
      <span className="bp-find-count" role="status">
        {countLabel(text, found)}
      </span>
      <button
        type="button"
        className="icon-btn bp-tool"
        aria-label="Previous match"
        disabled={text === ''}
        onClick={() => find(text, false, true)}
      >
        <ArrowUpIcon />
      </button>
      <button
        type="button"
        className="icon-btn bp-tool"
        aria-label="Next match"
        disabled={text === ''}
        onClick={() => find(text, true, true)}
      >
        <ArrowDownIcon />
      </button>
      <button type="button" className="icon-btn bp-tool" aria-label="Close find" onClick={onClose}>
        <CloseIcon />
      </button>
    </div>
  );
}
