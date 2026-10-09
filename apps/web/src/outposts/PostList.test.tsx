// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { threadItems, type OutpostPost } from '@spark-outpost/contracts';
import { PostList } from './PostList.tsx';
import { note, notice, post } from './test-fixtures.ts';

class QuietResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', QuietResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function list(posts: OutpostPost[], answeringId: string | null = null) {
  return (
    <PostList
      items={threadItems(posts)}
      answeringId={answeringId}
      empty={<p>Nothing here yet</p>}
      onAnswer={vi.fn()}
      onCancel={vi.fn()}
      onOpenChat={vi.fn()}
    />
  );
}

function heard(): string[] {
  return within(screen.getByRole('log'))
    .queryAllByText(/./)
    .map((line) => line.textContent ?? '');
}

describe('PostList', () => {
  it('draws requests, notes and notices as one list in time order', () => {
    render(
      list([note(3, { body: 'Third' }), notice(1, '@api joined.'), post(2, { body: 'Second' })]),
    );
    const items = within(screen.getByRole('list', { name: 'Outpost thread' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.textContent)).toEqual([
      '@api joined.',
      expect.stringContaining('Second'),
      expect.stringContaining('Third'),
    ]);
  });

  it('shows the empty state only while there are no posts', () => {
    const { rerender } = render(list([]));
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    rerender(list([post(1)]));
    expect(screen.queryByText('Nothing here yet')).toBeNull();
  });

  it('announces nothing for the posts it opened with', () => {
    render(list([post(1), note(2)]));
    expect(screen.getByRole('log').getAttribute('aria-live')).toBe('polite');
    expect(heard()).toEqual([]);
  });

  it('announces a new post and a change of state, and nothing for an unchanged refresh', () => {
    const { rerender } = render(list([post(1)]));
    rerender(list([post(1), note(2, { fromUser: false, fromHandle: 'fe' })]));
    expect(heard()).toEqual(['@fe posted a note.']);
    rerender(list([post(1, { state: 'working' }), note(2, { fromUser: false, fromHandle: 'fe' })]));
    expect(heard()).toEqual(['Request to @api: Working.']);
    rerender(list([post(1, { state: 'working' }), note(2, { fromUser: false, fromHandle: 'fe' })]));
    expect(heard()).toEqual(['Request to @api: Working.']);
    rerender(
      list([
        post(1, { state: 'failed', reason: 'Not delivered: queue full' }),
        note(2, { fromUser: false, fromHandle: 'fe' }),
        post(3, { body: 'Run the tests' }),
        notice(4, '@docs joined.'),
      ]),
    );
    expect(heard()).toEqual([
      'Request to @api: Failed. Not delivered: queue full.',
      'You asked @api. Sent.',
      '@docs joined.',
    ]);
  });

  it('keeps the scroll position and the mounted posts when a refresh brings new data', () => {
    const { rerender, container } = render(list([post(1), post(2)]));
    const scroller = container.querySelector<HTMLElement>('.thread')!;
    const first = screen.getAllByRole('listitem')[0];
    scroller.scrollTop = 120;
    rerender(list([post(1, { state: 'answered' }), post(2), post(3)]));
    expect(scroller.scrollTop).toBe(120);
    expect(screen.getAllByRole('listitem')[0]).toBe(first);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks the request the message box is answering', () => {
    const asked = post(1, { state: 'needs_you' });
    render(list([asked, post(2, { state: 'needs_you' })], asked.id));
    const pressed = screen
      .getAllByRole('button', { name: 'Answer' })
      .map((button) => button.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false']);
  });
});
