// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatFace } from './ChatFace.tsx';
import { CHAT_FACE_STATES } from './chat-face.ts';

const FIRST = '0c000000-0000-4000-8000-000000000001';
const SECOND = '0c000000-0000-4000-8000-000000000002';

function reduceMotion(reduced: boolean): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function face(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('.chat-face');
  if (!found) throw new Error('No chat face was drawn.');
  return found;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatFace', () => {
  it('is decorative unless it is given a label', () => {
    const { container } = render(<ChatFace chatId={FIRST} size="row" />);
    expect(face(container).getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
    cleanup();
    render(<ChatFace chatId={FIRST} size="row" state="needs_you" label="Needs you" />);
    expect(screen.getByRole('img', { name: 'Needs you' })).toBeTruthy();
  });

  it('draws the same blob for a chat every time and a different one for another chat', () => {
    const first = render(<ChatFace chatId={FIRST} size="strip" />).container.innerHTML;
    cleanup();
    const again = render(<ChatFace chatId={FIRST} size="strip" />).container.innerHTML;
    cleanup();
    const other = render(<ChatFace chatId={SECOND} size="strip" />).container.innerHTML;
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('changes the expression with the state and keeps the colour, shape and box', () => {
    const seen = CHAT_FACE_STATES.map((state) => {
      const { container } = render(<ChatFace chatId={FIRST} size="row" state={state} />);
      const { color, shape, expression, size } = face(container).dataset;
      cleanup();
      return { color, shape, expression, size };
    });
    expect(new Set(seen.map((look) => look.expression)).size).toBe(CHAT_FACE_STATES.length);
    expect(new Set(seen.map((look) => `${look.color}:${look.shape}:${look.size}`)).size).toBe(1);
  });

  it('moves only while the chat is working or waiting', () => {
    reduceMotion(false);
    const quiet = render(<ChatFace chatId={FIRST} size="row" state="done" />).container;
    expect(quiet.querySelector('img')).toBeTruthy();
    expect(quiet.querySelector('svg')).toBeNull();
    cleanup();
    const busy = render(<ChatFace chatId={FIRST} size="row" state="working" />).container;
    expect(busy.querySelector('svg')).toBeTruthy();
  });

  it('holds still when the user asks for less motion', () => {
    reduceMotion(true);
    const { container } = render(<ChatFace chatId={FIRST} size="row" state="working" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(face(container).dataset.expression).toBe('thinking');
  });
});
