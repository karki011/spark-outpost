// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemberStrip } from './MemberStrip.tsx';
import { API_CHAT, DOCS_CHAT, FE_CHAT, memberView } from './test-fixtures.ts';

const MEMBERS = [
  memberView(FE_CHAT, 'fe', { state: 'needs_you', stateLabel: 'Needs you', place: 'web · main' }),
  memberView(API_CHAT, 'api'),
  memberView(DOCS_CHAT, 'docs', { state: 'archived', stateLabel: 'Archived', archived: true }),
];

afterEach(cleanup);

function chips(): HTMLElement[] {
  return within(screen.getByRole('toolbar', { name: 'Chats in this outpost' })).getAllByRole(
    'button',
  );
}

describe('MemberStrip', () => {
  it('shows each chat with its handle and its state as text', () => {
    render(<MemberStrip members={MEMBERS} onOpen={vi.fn()} />);
    expect(chips().map((chip) => chip.textContent)).toEqual([
      expect.stringContaining('@feNeeds youweb · main'),
      expect.stringContaining('@apiIdle'),
      expect.stringContaining('@docsArchived'),
    ]);
  });

  it('is one tab stop that the arrow keys move through, wrapping at the ends', () => {
    render(<MemberStrip members={MEMBERS} onOpen={vi.fn()} />);
    const toolbar = screen.getByRole('toolbar');
    expect(chips().map((chip) => chip.tabIndex)).toEqual([0, -1, -1]);
    chips()[0]?.focus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(chips()[1]);
    expect(chips().map((chip) => chip.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(toolbar, { key: 'End' });
    expect(document.activeElement).toBe(chips()[2]);
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(chips()[0]);
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(chips()[2]);
    fireEvent.keyDown(toolbar, { key: 'Home' });
    expect(document.activeElement).toBe(chips()[0]);
  });

  it('opens the chat when a chip is activated', () => {
    const onOpen = vi.fn<(conversationId: string) => void>();
    render(<MemberStrip members={MEMBERS} onOpen={onOpen} />);
    fireEvent.click(chips()[1]!);
    expect(onOpen).toHaveBeenCalledWith(API_CHAT);
  });

  it('keeps a tab stop when the focused chat leaves the outpost', () => {
    const { rerender } = render(<MemberStrip members={MEMBERS} onOpen={vi.fn()} />);
    chips()[2]?.focus();
    rerender(<MemberStrip members={MEMBERS.slice(0, 2)} onOpen={vi.fn()} />);
    expect(chips().map((chip) => chip.tabIndex)).toEqual([-1, 0]);
  });

  it('draws nothing for an outpost with no chats', () => {
    const { container } = render(<MemberStrip members={[]} onOpen={vi.fn()} />);
    expect(container.childElementCount).toBe(0);
  });
});
