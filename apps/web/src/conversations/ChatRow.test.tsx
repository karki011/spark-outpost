// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { ChatRow } from './ChatRow.tsx';

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

function renderRow(handle?: string) {
  render(
    <ul>
      <ChatRow
        chat={chat}
        selected={false}
        renaming={false}
        sortable={false}
        settling={false}
        flash={false}
        index={0}
        handle={handle}
        onOpen={vi.fn()}
        onMenu={vi.fn()}
        onRename={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />
    </ul>,
  );
}

describe('ChatRow handle', () => {
  it('shows the whole handle of an outpost member under its title and keeps the row menu', () => {
    renderRow('feature-dashboar');
    const open = screen.getByRole('button', { name: /^Orders API/ });
    expect(open.querySelector('.row-handle')?.textContent).toBe('@feature-dashboar');
    expect(open.getAttribute('title')).toContain('@feature-dashboar');
    expect(screen.getByRole('button', { name: 'Options for Orders API' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move Orders API' })).toBeNull();
  });

  it('shows no handle on an ordinary chat row', () => {
    renderRow();
    expect(document.querySelector('.row-handle')).toBeNull();
    expect(document.querySelector('.row-member')).toBeNull();
  });
});
