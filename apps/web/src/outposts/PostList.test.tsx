// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { threadItems, type OutpostPost } from '@spark-outpost/contracts';
import { PostList } from './PostList.tsx';
import { requestsOf, threadCard } from './thread-cards.ts';
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

interface ListOptions {
  answeringId?: string | null;
  jumpTo?: string;
  onCancel?: (postId: string) => void;
}

function list(posts: OutpostPost[], options: ListOptions = {}) {
  const items = threadItems(posts);
  const cards = new Map(requestsOf(items).map((each) => [each.id, threadCard(each, [])]));
  return (
    <PostList
      items={items}
      cards={cards}
      selectedId={null}
      answeringId={options.answeringId ?? null}
      jumpTo={options.jumpTo}
      empty={<p>Nothing here yet</p>}
      onOpenThread={vi.fn()}
      onAnswer={vi.fn()}
      onCancel={options.onCancel ?? vi.fn()}
    />
  );
}

function heard(): string[] {
  return within(screen.getByRole('log'))
    .queryAllByText(/./)
    .map((line) => line.textContent ?? '');
}

const thread = () => screen.getByRole('list', { name: 'Outpost thread' });

describe('PostList', () => {
  it('draws requests, notes and notices as one list in time order', () => {
    render(
      list([note(3, { body: 'Third' }), notice(1, '@api joined'), post(2, { body: 'Second' })]),
    );
    const items = within(thread()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      '@api joined',
      expect.stringContaining('Second'),
      expect.stringContaining('Third'),
    ]);
  });

  it('puts a card for the request under the message that asked for it', () => {
    render(list([post(1, { body: '@api Add the usage endpoint' })]));
    const message = within(thread()).getAllByRole('listitem')[0]!;
    const card = within(message).getByRole('article');
    expect(card.getAttribute('aria-label')).toBe('@api: Add the usage endpoint. Queued');
  });

  it('starts each day with its date, read by neither the list nor a screen reader', () => {
    const { container } = render(
      list([
        post(1, { createdAt: '2026-10-08T10:00:00.000Z' }),
        post(2, { createdAt: '2026-10-09T10:00:00.000Z' }),
        post(3, { createdAt: '2026-10-09T11:00:00.000Z' }),
      ]),
    );
    const days = container.querySelectorAll('.op-day');
    expect(days).toHaveLength(2);
    expect([...days].every((day) => day.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(within(thread()).getAllByRole('listitem')).toHaveLength(3);
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
  });

  it('keeps the scroll position and the mounted posts when a refresh brings new data', () => {
    const { rerender, container } = render(list([post(1), post(2)]));
    const scroller = container.querySelector<HTMLElement>('.thread')!;
    const first = within(thread()).getAllByRole('listitem')[0];
    scroller.scrollTop = 120;
    rerender(list([post(1, { state: 'answered' }), post(2), post(3)]));
    expect(scroller.scrollTop).toBe(120);
    expect(within(thread()).getAllByRole('listitem')[0]).toBe(first);
    expect(within(thread()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks the request the message box is answering', () => {
    const asked = post(1, { state: 'needs_you' });
    render(list([asked, post(2, { state: 'needs_you' })], { answeringId: asked.id }));
    const pressed = screen
      .getAllByRole('button', { name: 'Answer @api' })
      .map((button) => button.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false']);
  });

  it('scrolls to the request it was opened for and flashes its card', () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    const wanted = post(1, { body: 'First' });
    render(list([wanted, post(2, { body: 'Second' })], { jumpTo: wanted.id }));
    const [first, second] = screen.getAllByRole('article');
    expect(scrolled).toEqual([first]);
    expect(first?.classList.contains('flash')).toBe(true);
    expect(second?.classList.contains('flash')).toBe(false);
  });

  it('stays at the latest post when it was not opened for one', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(list([post(1), post(2)]));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('cancels every open request of a message sent to several chats, after asking', () => {
    const onCancel = vi.fn();
    const batch = 'f0f0f0f0-1a2b-4c3d-8e9f-001122334455';
    render(
      list(
        [
          post(1, { batchId: batch, toHandle: 'api' }),
          post(2, { batchId: batch, toHandle: 'fe', state: 'working' }),
        ],
        { onCancel },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all 2 open requests…' }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    expect(onCancel.mock.calls.map(([id]) => id)).toEqual([post(1).id, post(2).id]);
  });
});
