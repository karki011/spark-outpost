// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUB_CHAT_STATUS_WORDS,
  type ConversationSummary,
  type SubChatStatus,
} from '@spark-outpost/contracts';
import { ChatRow } from './ChatRow.tsx';
import { listedChatIds } from './chat-number-keys.ts';
import { SubChatStatusWord } from './SubChatStatusWord.tsx';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const chat = (id: string, extra: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id,
  title: id,
  updatedAt: '2026-11-20T10:00:00Z',
  projectIds: [],
  latestRun: null,
  archivedAt: null,
  pinnedAt: null,
  pinnedOrder: null,
  projectOrder: null,
  unread: false,
  needsInput: false,
  attention: null,
  titleSource: 'message',
  category: null,
  ...extra,
});

const PARENT = chat('Checkout rewrite', { subChatCount: 2 });

const sub = (title: string, position: number, status: SubChatStatus): ConversationSummary =>
  chat(title, { parent: { id: PARENT.id, title: PARENT.title }, subChat: { position, status } });

const SUBS = [sub('Payments API', 0, 'ready_for_review'), sub('Cart totals', 1, 'needs_you')];

const handlers = () => ({
  onMenu: vi.fn(),
  onRename: vi.fn(),
  onRestore: vi.fn(),
  onDelete: vi.fn(),
});

const fixed = { selected: false, renaming: false, sortable: false, settling: false, flash: false };

function Tree({ onOpen, startOpen = true }: { onOpen: (id: string) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <ul data-testid="list">
      <ChatRow
        chat={PARENT}
        {...fixed}
        index={0}
        onOpen={onOpen}
        {...handlers()}
        tree={{
          subs: SUBS,
          open,
          onToggle: () => setOpen((shown) => !shown),
          renderRow: (row, index) => (
            <ChatRow
              key={row.id}
              chat={row}
              {...fixed}
              index={index}
              faceless
              nested
              onOpen={onOpen}
              {...handlers()}
            />
          ),
        }}
      />
    </ul>
  );
}

function renderTree(startOpen = true) {
  const onOpen = vi.fn();
  render(<Tree onOpen={onOpen} startOpen={startOpen} />);
  return { onOpen };
}

const parentRow = () => screen.getByRole('button', { name: /^Checkout rewrite/ });
const fold = () => screen.getByRole('button', { name: '2 sub-chats of Checkout rewrite' });
const subList = () => screen.getByRole('list', { name: 'Sub-chats of Checkout rewrite' });
const subRow = (title: string) =>
  within(subList()).getByRole('button', { name: new RegExp(`^${title}`) });

describe('sub-chat rows', () => {
  it('nests the sub-chats in a labelled list under the parent row', () => {
    renderTree();
    const rows = within(subList()).getAllByRole('listitem');
    expect(rows.map((row) => row.dataset.chat)).toEqual(['Payments API', 'Cart totals']);
    expect(fold().getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(fold().getAttribute('aria-controls') ?? '')).toBe(
      subList().parentElement,
    );
  });

  it('shows each status as an icon and a word and reads it in the row name', () => {
    renderTree();
    const row = subRow('Payments API');
    expect(row.textContent).toContain('Ready for review');
    expect(row.querySelector('.sub-status svg')).not.toBeNull();
    expect(row.textContent).not.toContain('↳');
  });

  it('counts the sub-chats that need the user on the parent row', () => {
    renderTree();
    expect(parentRow().textContent).toContain('1 sub-chat needs you');
  });

  it('opens a sub-chat from its row', () => {
    const { onOpen } = renderTree();
    fireEvent.click(subRow('Cart totals'));
    expect(onOpen).toHaveBeenCalledWith('Cart totals');
  });

  it('folds from the arrow and keeps the rows mounted but out of reach', () => {
    renderTree();
    const list = subList();
    fireEvent.click(fold());
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    expect(list.isConnected).toBe(true);
    expect(list.parentElement?.hasAttribute('inert')).toBe(true);
    expect(listedChatIds(screen.getByTestId('list'))).toEqual(['Checkout rewrite']);
  });

  it('folds with Left and unfolds with Right on the parent row', () => {
    renderTree();
    fireEvent.keyDown(parentRow(), { key: 'ArrowLeft' });
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(parentRow(), { key: 'ArrowLeft' });
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(parentRow(), { key: 'ArrowRight' });
    expect(fold().getAttribute('aria-expanded')).toBe('true');
  });

  it('moves focus into the open tree with Right and back to the parent with Left', () => {
    renderTree();
    parentRow().focus();
    fireEvent.keyDown(parentRow(), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(subRow('Payments API'));
    fireEvent.keyDown(subRow('Payments API'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(parentRow());
    expect(fold().getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves arrows with a modifier alone', () => {
    renderTree();
    fireEvent.keyDown(parentRow(), { key: 'ArrowLeft', altKey: true });
    expect(fold().getAttribute('aria-expanded')).toBe('true');
  });

  it('lists the open sub-chats for the number keys, in order', () => {
    renderTree();
    expect(listedChatIds(screen.getByTestId('list'))).toEqual([
      'Checkout rewrite',
      'Payments API',
      'Cart totals',
    ]);
  });
});

describe('flattened rows', () => {
  const renderFlat = (row: ConversationSummary) =>
    render(
      <ul>
        <ChatRow chat={row} {...fixed} index={0} onOpen={vi.fn()} {...handlers()} />
      </ul>,
    );

  it('marks a sub-chat with its parent and keeps its status', () => {
    renderFlat(SUBS[0]!);
    const row = screen.getByRole('button', { name: /^Payments API/ });
    expect(row.querySelector('.parent-mark')?.textContent).toBe('↳ , sub-chat of Checkout rewrite');
    expect(row.textContent).toContain('Ready for review');
  });

  it('says what a chat was part of once its parent is deleted', () => {
    renderFlat(chat('Search index', { formerParent: { title: 'Catalog cleanup' } }));
    const row = screen.getByRole('button', { name: /^Search index/ });
    expect(row.querySelector('.parent-mark')?.textContent).toBe('· , was part of Catalog cleanup');
  });
});

describe('SubChatStatusWord', () => {
  it('gives every status its own word and an icon', () => {
    for (const status of Object.keys(SUB_CHAT_STATUS_WORDS) as SubChatStatus[]) {
      const { container, unmount } = render(<SubChatStatusWord status={status} />);
      expect(container.textContent).toBe(SUB_CHAT_STATUS_WORDS[status]);
      expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });
});
