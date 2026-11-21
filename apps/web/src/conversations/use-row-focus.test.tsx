// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useRowFocus } from './use-row-focus.ts';

afterEach(cleanup);

function Row({ id }: { id: string }) {
  return (
    <li data-chat={id}>
      <button type="button" className="row-open">
        Open {id}
      </button>
      <button type="button" className="rmenu">
        Options for {id}
      </button>
    </li>
  );
}

function List({ nested }: { nested: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  useRowFocus(listRef, nested ? 'api:orders' : '');
  return (
    <>
      <div ref={listRef}>
        <ul aria-label="Sub-chats">{nested && <Row id="api" />}</ul>
        <ul aria-label="Project">
          {!nested && <Row id="api" />}
          <Row id="docs" />
        </ul>
      </div>
      <button type="button">Elsewhere</button>
    </>
  );
}

describe('useRowFocus', () => {
  it('keeps focus on the same control when a chat moves under its parent', () => {
    const view = render(<List nested={false} />);
    screen.getByRole('button', { name: 'Options for api' }).focus();
    view.rerender(<List nested />);
    const moved = screen.getByRole('button', { name: 'Options for api' });
    expect(moved.closest('ul')?.getAttribute('aria-label')).toBe('Sub-chats');
    expect(document.activeElement).toBe(moved);
  });

  it('keeps focus on the row itself when the chat returns to its project', () => {
    const view = render(<List nested />);
    screen.getByRole('button', { name: 'Open api' }).focus();
    view.rerender(<List nested={false} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open api' }));
  });

  it('takes no focus when it had moved elsewhere before the chat moved', () => {
    const view = render(<List nested={false} />);
    screen.getByRole('button', { name: 'Options for api' }).focus();
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    view.rerender(<List nested />);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('leaves focus alone when another chat moves', () => {
    const view = render(<List nested={false} />);
    const docs = screen.getByRole('button', { name: 'Open docs' });
    docs.focus();
    view.rerender(<List nested />);
    expect(document.activeElement).toBe(docs);
  });
});
