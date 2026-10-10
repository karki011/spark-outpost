// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { threadItems, type OutpostPost } from '@spark-outpost/contracts';
import { PostList } from './PostList.tsx';
import { API_CHAT, FE_CHAT, post, postId } from './test-fixtures.ts';

const BATCH = postId(90);
const TEXT = 'Could @api list the fields so that @fe can draw them?';

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

function toApi(overrides: Partial<OutpostPost> = {}): OutpostPost {
  return post(1, { batchId: BATCH, body: TEXT, ...overrides });
}

function toFe(overrides: Partial<OutpostPost> = {}): OutpostPost {
  return post(2, {
    batchId: BATCH,
    body: TEXT,
    toHandle: 'fe',
    toConversationId: FE_CHAT,
    ...overrides,
  });
}

function thread(posts: OutpostPost[], extra: Partial<Parameters<typeof PostList>[0]> = {}) {
  const handlers = { onAnswer: vi.fn(), onCancel: vi.fn(), onOpenChat: vi.fn() };
  const view = render(
    <PostList
      items={threadItems(posts)}
      answeringId={null}
      empty={null}
      {...handlers}
      {...extra}
    />,
  );
  return { ...handlers, ...view };
}

function line(handle: string): HTMLElement {
  return screen.getByRole('listitem', { name: handle });
}

describe('a message sent to several chats', () => {
  it('shows once, with a line per chat under it', () => {
    thread([toApi({ state: 'working' }), toFe({ state: 'sent', reason: 'Not sent yet' })]);
    const posts = document.querySelectorAll('.op-post');
    expect(posts).toHaveLength(1);
    expect(screen.getAllByText(TEXT)).toHaveLength(1);
    expect(posts[0]?.querySelector('.op-post-head')?.textContent).toContain('Youto@api@fe');
    expect(within(line('@api')).getByText('Working')).toBeTruthy();
    expect(within(line('@fe')).getByText('Sent')).toBeTruthy();
    expect(within(line('@fe')).getByText('Not sent yet')).toBeTruthy();
  });

  it('threads each answer under its own chat', () => {
    const answer = (text: string) => ({ text, branch: null, changes: [], pullRequests: [] });
    thread([
      toApi({ state: 'answered', answer: answer('Five fields.') }),
      toFe({ state: 'needs_you', reason: 'Light or dark?', answer: answer('Drawn.') }),
    ]);
    expect(within(line('@api')).getByText('Five fields.')).toBeTruthy();
    expect(within(line('@api')).queryByText('Drawn.')).toBeNull();
    expect(within(line('@fe')).getByText('Drawn.')).toBeTruthy();
    expect(within(line('@fe')).getByText('Light or dark?')).toBeTruthy();
  });

  it('answers, cancels and opens one chat from its own line', () => {
    const asking = toFe({ state: 'needs_you' });
    const { onAnswer, onCancel, onOpenChat } = thread([toApi({ state: 'working' }), asking]);
    fireEvent.click(within(line('@fe')).getByRole('button', { name: 'Answer' }));
    fireEvent.click(within(line('@api')).getByRole('button', { name: 'Cancel request to @api' }));
    fireEvent.click(within(line('@fe')).getByRole('button', { name: 'Open @fe in chat' }));
    expect(onAnswer).toHaveBeenCalledWith(asking);
    expect(onCancel.mock.calls).toEqual([[postId(1)]]);
    expect(onOpenChat).toHaveBeenCalledWith(FE_CHAT);
  });

  it('cancels every chat that is still open with Cancel all', () => {
    const third = post(3, { batchId: BATCH, body: TEXT, toHandle: 'docs', state: 'answered' });
    const { onCancel } = thread([toApi({ state: 'working' }), toFe({ state: 'sent' }), third]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all' }));
    expect(onCancel.mock.calls).toEqual([[postId(1)], [postId(2)]]);
  });

  it('offers no Cancel all when at most one chat is still open', () => {
    thread([toApi({ state: 'working' }), toFe({ state: 'answered' })]);
    expect(screen.queryByRole('button', { name: 'Cancel all' })).toBeNull();
  });

  it('marks the message while one of its chats is being answered', () => {
    thread([toApi(), toFe({ state: 'needs_you' })], { answeringId: postId(2) });
    expect(document.querySelector('.op-post.answering')).toBeTruthy();
    const answer = within(line('@fe')).getByRole('button', { name: 'Answer' });
    expect(answer.getAttribute('aria-pressed')).toBe('true');
  });

  it('scrolls to the line of the chat it was opened for', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    thread([toApi(), toFe()], { jumpTo: postId(2) });
    expect(scrolled.mock.contexts).toEqual([line('@fe')]);
    expect(line('@fe').classList.contains('flash')).toBe(true);
  });

  it('announces each chat on its own', () => {
    const { rerender } = thread([toApi({ state: 'working' }), toFe({ state: 'working' })]);
    rerender(
      <PostList
        items={threadItems([toApi({ state: 'answered' }), toFe({ state: 'working' })])}
        answeringId={null}
        empty={null}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    expect(within(screen.getByRole('log')).getByText('Request to @api: Answered.')).toBeTruthy();
  });
});

describe('what a working chat is doing', () => {
  const doing = new Map([[API_CHAT, 'Running the tests']]);

  it('shows under a request that is Working, and changes with the chat', () => {
    const working = [post(1, { state: 'working' })];
    const { rerender } = thread(working, { activity: doing });
    expect(document.querySelector('.op-activity')?.textContent).toBe('Running the tests');
    rerender(
      <PostList
        items={threadItems(working)}
        answeringId={null}
        activity={new Map([[API_CHAT, 'Editing orders.ts']])}
        empty={null}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
        onOpenChat={vi.fn()}
      />,
    );
    expect(document.querySelector('.op-activity')?.textContent).toBe('Editing orders.ts');
  });

  it('shows on the line of the working chat only', () => {
    thread([toApi({ state: 'working' }), toFe({ state: 'working' })], { activity: doing });
    expect(within(line('@api')).getByText('Running the tests')).toBeTruthy();
    expect(line('@fe').querySelector('.op-activity')).toBeNull();
  });

  it('is not shown for a request in any other state', () => {
    for (const state of ['sent', 'needs_you', 'answered', 'failed', 'cancelled'] as const) {
      thread([post(1, { state })], { activity: doing });
      expect(document.querySelector('.op-activity')).toBeNull();
      cleanup();
    }
  });
});
