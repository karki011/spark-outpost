// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatFace } from '../brand/ChatFace.tsx';
import { OutpostFaces } from './MemberFace.tsx';
import { MemberStrip } from './MemberStrip.tsx';
import { API_CHAT, DOCS_CHAT, FE_CHAT, member, memberView } from './test-fixtures.ts';

const GOLD_TOO = '0c000000-0000-4000-8000-000000000009';

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
      expect.stringContaining('@fe, Needs you'),
      expect.stringContaining('@api, Idle'),
      expect.stringContaining('@docs, Archived'),
    ]);
  });

  it('draws each chat its own blob, with a face for its state that is not read out', () => {
    render(<MemberStrip members={MEMBERS} onOpen={vi.fn()} />);
    const faces = chips().map((chip) => chip.querySelector<HTMLElement>('.chat-face'));
    expect(faces.map((face) => face?.dataset.expression)).toEqual(['unsure', 'idle', 'sleepy']);
    expect(faces.map((face) => face?.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
      'true',
    ]);
    expect(new Set(faces.map((face) => face?.innerHTML)).size).toBe(3);
  });

  it('gives two chats with the same colour different blobs here, and leaves their own alone', () => {
    const joined = [
      { ...member(FE_CHAT, 'fe', 1), joinedAt: '2026-10-09T10:00:00.000Z' },
      { ...member(GOLD_TOO, 'mobile', 2), joinedAt: '2026-10-09T10:05:00.000Z' },
    ];
    render(
      <>
        <OutpostFaces members={joined}>
          <MemberStrip
            members={[memberView(FE_CHAT, 'fe'), memberView(GOLD_TOO, 'mobile')]}
            onOpen={vi.fn()}
          />
        </OutpostFaces>
        <ChatFace chatId={GOLD_TOO} size="row" label="Its own blob" />
      </>,
    );
    const faces = chips().map((chip) => chip.querySelector<HTMLElement>('.chat-face'));
    expect(faces.map((face) => face?.dataset.color)).toEqual(['gold', 'ember']);
    expect(faces[0]?.innerHTML).not.toBe(faces[1]?.innerHTML);
    expect(screen.getByRole('img', { name: 'Its own blob' }).dataset.color).toBe('gold');
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
