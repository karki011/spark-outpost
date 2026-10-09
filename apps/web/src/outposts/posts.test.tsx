// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutpostPost, RequestState } from '@spark-outpost/contracts';
import { NotePost } from './NotePost.tsx';
import { NoticeLine } from './NoticeLine.tsx';
import { RequestPost } from './RequestPost.tsx';
import { API_CHAT, FE_CHAT, note, notice, post } from './test-fixtures.ts';

afterEach(cleanup);

interface Handlers {
  onAnswer: ReturnType<typeof vi.fn<(post: OutpostPost) => void>>;
  onCancel: ReturnType<typeof vi.fn<(postId: string) => void>>;
  onOpenChat: ReturnType<typeof vi.fn<(conversationId: string) => void>>;
}

function renderRequest(request: OutpostPost, answering = false): Handlers {
  const handlers: Handlers = {
    onAnswer: vi.fn<(post: OutpostPost) => void>(),
    onCancel: vi.fn<(postId: string) => void>(),
    onOpenChat: vi.fn<(conversationId: string) => void>(),
  };
  render(
    <ol>
      <RequestPost post={request} answering={answering} {...handlers} />
    </ol>,
  );
  return handlers;
}

function buttons(): string[] {
  return within(screen.getByRole('listitem'))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
}

describe('RequestPost', () => {
  const cases: [RequestState, string, string[]][] = [
    ['sent', 'Sent', ['Cancel', 'Open in chat']],
    ['working', 'Working', ['Cancel', 'Open in chat']],
    ['needs_you', 'Needs you', ['Answer', 'Cancel', 'Open in chat']],
    ['answered', 'Answered', ['Open in chat']],
    ['failed', 'Failed', ['Open in chat']],
    ['cancelled', 'Cancelled', ['Open in chat']],
  ];

  it.each(cases)('shows %s as the word %s with the actions that fit', (state, word, actions) => {
    renderRequest(post(1, { state }));
    expect(screen.getByText(word)).toBeTruthy();
    expect(buttons()).toEqual(actions);
  });

  it('says who asked whom', () => {
    renderRequest(post(1));
    expect(screen.getByRole('listitem').textContent).toContain('Youto@api');
  });

  it('names the asking chat for a request another chat wrote', () => {
    renderRequest(post(1, { fromUser: false, fromConversationId: FE_CHAT, fromHandle: 'fe' }));
    expect(screen.getByRole('listitem').textContent).toContain('@feto@api');
  });

  it('shows the reason line under the request', () => {
    renderRequest(post(1, { state: 'failed', reason: 'Not delivered: queue full' }));
    expect(screen.getByText('Not delivered: queue full')).toBeTruthy();
  });

  it('threads the answer under the request with its branch, files and pull request', () => {
    renderRequest(
      post(1, {
        state: 'answered',
        answer: {
          text: 'Done. userId is optional.',
          branch: 'spark/usage-userid-filter',
          changes: ['src/usage.ts', 'test/usage.test.ts'],
          pullRequests: ['https://github.com/acme/api/pull/2241', 'javascript:alert(1)'],
        },
      }),
    );
    expect(screen.getByText('Done. userId is optional.')).toBeTruthy();
    expect(screen.getByText('spark/usage-userid-filter')).toBeTruthy();
    expect(screen.getByText('2 files changed')).toBeTruthy();
    expect(screen.getByText('src/usage.ts')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('Pull request #2241');
    expect(links[0]?.getAttribute('href')).toBe('https://github.com/acme/api/pull/2241');
  });

  it('collapses a long request and opens it on demand', () => {
    renderRequest(post(1, { body: 'one\ntwo\nthree\nfour\nfive' }));
    const text = screen.getByText(/one/);
    expect(text.className).toContain('clamped');
    const toggle = screen.getByRole('button', { name: 'Show all of the request' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(text.className).not.toContain('clamped');
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
  });

  it('leaves a short request alone', () => {
    renderRequest(post(1));
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull();
  });

  it('marks a request to a chat outside the outpost as guest', () => {
    renderRequest(post(1, { guest: true }));
    expect(screen.getByText('guest')).toBeTruthy();
  });

  it('hands Answer, Cancel and Open in chat to the page', () => {
    const request = post(1, { state: 'needs_you', reason: 'Light or dark theme?' });
    const handlers = renderRequest(request);
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request to @api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open @api in chat' }));
    expect(handlers.onAnswer).toHaveBeenCalledWith(request);
    expect(handlers.onCancel).toHaveBeenCalledWith(request.id);
    expect(handlers.onOpenChat).toHaveBeenCalledWith(API_CHAT);
  });

  it('shows which request the message box is answering', () => {
    renderRequest(post(1, { state: 'needs_you' }), true);
    expect(screen.getByRole('button', { name: 'Answer' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('offers no way into a chat that was deleted', () => {
    renderRequest(post(1, { state: 'failed', reason: 'Chat deleted', toConversationId: null }));
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('NotePost', () => {
  it('is marked as a note and has no state or actions', () => {
    render(
      <ol>
        <NotePost post={note(2, { fromUser: false, fromHandle: 'api' })} />
      </ol>,
    );
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('@apinote');
    expect(item.textContent).toContain('The contract is settled.');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('NoticeLine', () => {
  it('is one line of text', () => {
    render(
      <ol>
        <NoticeLine post={notice(3, '@api joined. @fe and @api can now ask each other.')} />
      </ol>,
    );
    expect(screen.getByRole('listitem').textContent).toBe(
      '@api joined. @fe and @api can now ask each other.',
    );
  });
});
