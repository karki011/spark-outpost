// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { ChatRow } from './ChatRow.tsx';
import { OnScreenChat } from './on-screen.ts';

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
  vi.useRealTimers();
});

const chat: ConversationSummary = {
  id: '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b301',
  title: 'Orders API',
  updatedAt: '2026-10-09T10:00:00Z',
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
};

function renderRow(
  handle?: string,
  row: ConversationSummary = chat,
  selected = false,
  onScreenId: string | null = null,
  member: { faceless?: boolean; relation?: string | null } = {},
  onPrepare?: (id: string) => void,
) {
  render(
    <OnScreenChat.Provider value={onScreenId ? [onScreenId] : []}>
      <ul>
        <ChatRow
          chat={row}
          selected={selected}
          renaming={false}
          sortable={false}
          settling={false}
          flash={false}
          index={0}
          handle={handle}
          {...member}
          onOpen={vi.fn()}
          {...(onPrepare ? { onPrepare } : {})}
          onMenu={vi.fn()}
          onRename={vi.fn()}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
        />
      </ul>
    </OnScreenChat.Provider>,
  );
}

const finished: ConversationSummary = {
  ...chat,
  seenAt: '2026-10-09T10:00:00Z',
  unread: true,
  latestRun: {
    id: '7a1f0c1e-6f0e-4d57-9a3e-0d8a53a7b302',
    status: 'succeeded',
    error: null,
    step: null,
    provider: null,
    progress: null,
    finishedAt: '2026-10-09T11:00:00Z',
  },
};

describe('ChatRow', () => {
  it('warms only a deliberate focus and cancels preparation on blur or unmount', () => {
    vi.useFakeTimers();
    const prepare = vi.fn();
    renderRow(undefined, chat, false, null, {}, prepare);
    const open = screen.getByRole('button', { name: /^Orders API/ });
    vi.spyOn(open, 'matches').mockReturnValue(true);
    fireEvent.focus(open);
    vi.advanceTimersByTime(149);
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.blur(open);
    vi.advanceTimersByTime(200);
    expect(prepare).not.toHaveBeenCalled();
    fireEvent.focus(open);
    vi.advanceTimersByTime(150);
    expect(prepare).toHaveBeenCalledExactlyOnceWith(chat.id);
    fireEvent.focus(open);
    cleanup();
    vi.advanceTimersByTime(200);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('does not warm the already selected chat', () => {
    vi.useFakeTimers();
    const prepare = vi.fn();
    renderRow(undefined, chat, true, null, {}, prepare);
    const open = screen.getByRole('button', { name: /^Orders API/ });
    vi.spyOn(open, 'matches').mockReturnValue(true);
    fireEvent.focus(open);
    vi.advanceTimersByTime(200);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('shows only the title, and keeps an outpost handle in the name and tooltip', () => {
    renderRow('feature-dashboar');
    const open = screen.getByRole('button', { name: /^Orders API, @feature-dashboar/ });
    expect(open.getAttribute('title')).toContain('@feature-dashboar');
    expect(open.querySelector('.tt')?.textContent).toBe('Orders API');
    expect(open.querySelector('.sub')).toBeNull();
    expect(screen.getByRole('button', { name: 'Options for Orders API' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move Orders API' })).toBeNull();
  });

  it('draws a sub-chat without a face, with its state as a word and its relation in the name', () => {
    renderRow('web', finished, false, null, {
      faceless: true,
      relation: 'Sub-chat of @lead, starts after @api',
    });
    const open = screen.getByRole('button', {
      name: /^Orders API, @web, Sub-chat of @lead, starts after @api/,
    });
    expect(open.getAttribute('title')).toContain('@web · Sub-chat of @lead, starts after @api');
    expect(open.querySelector('.st')).toBeNull();
    expect(open.querySelector('.row-state')?.textContent).toBe('Done');
    cleanup();
    renderRow('lead', finished, false, null, { relation: 'Lead of 2 sub-chats' });
    expect(document.querySelector('.row-open .st')).toBeTruthy();
    expect(document.querySelector('.row-state')?.textContent).toBe('Done');
  });

  it('names the blob of a chat that finished since it was seen', () => {
    renderRow(undefined, finished);
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Orders API.*Done$/ })).toBeTruthy();
  });

  it('shows no blob on the chat that is on screen, or on a quiet one', () => {
    renderRow(undefined, finished, true, finished.id);
    expect(screen.queryByRole('img', { name: 'Done' })).toBeNull();
    cleanup();
    renderRow();
    expect(document.querySelector('.rblob')).toBeNull();
  });

  it('shows the blob on the selected chat while Settings or an outpost covers it', () => {
    renderRow(undefined, finished, true, null);
    expect(screen.getByRole('img', { name: 'Done' })).toBeTruthy();
  });
});
