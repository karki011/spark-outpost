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
  onStartNow: ReturnType<typeof vi.fn<(postId: string) => void>>;
}

function renderRequest(request: OutpostPost, answering = false, answerable = true): Handlers {
  const handlers: Handlers = {
    onAnswer: vi.fn<(post: OutpostPost) => void>(),
    onCancel: vi.fn<(postId: string) => void>(),
    onOpenChat: vi.fn<(conversationId: string) => void>(),
    onStartNow: vi.fn<(postId: string) => void>(),
  };
  render(
    <ol>
      <RequestPost post={request} answering={answering} answerable={answerable} {...handlers} />
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

  it('says how many files went with a request, and nothing when there are none', () => {
    renderRequest(post(1, { files: 2 }));
    expect(document.querySelector('.op-attached')?.textContent).toBe('2 files');
    cleanup();
    renderRequest(post(1));
    expect(document.querySelector('.op-attached')).toBeNull();
  });

  it('says who asked whom', () => {
    renderRequest(post(1));
    expect(screen.getByRole('listitem').textContent).toContain('Youto@api');
  });

  it('names the asking chat for a request another chat wrote', () => {
    renderRequest(post(1, { fromUser: false, fromConversationId: FE_CHAT, fromHandle: 'fe' }));
    expect(screen.getByRole('listitem').textContent).toContain('@fenot from youto@api');
    expect(document.querySelectorAll('.op-post-head .chat-face')).toHaveLength(2);
  });

  it('does not mark a request the user wrote', () => {
    renderRequest(post(1));
    expect(screen.queryByText('not from you')).toBeNull();
  });

  it('offers Start anyway on a request that waits for another chat', () => {
    const waiting = post(1, { reason: 'Waiting for @fe' });
    const handlers = renderRequest(waiting);
    expect(screen.getByText('Waiting for @fe')).toBeTruthy();
    expect(buttons()).toEqual(['Start anyway', 'Cancel', 'Open in chat']);
    fireEvent.click(screen.getByRole('button', { name: 'Start the request to @api anyway' }));
    expect(handlers.onStartNow).toHaveBeenCalledWith(waiting.id);
  });

  it('offers Start anyway when the chat it waits for was deleted', () => {
    renderRequest(post(1, { reason: 'Waiting for a deleted chat' }));
    expect(buttons()).toContain('Start anyway');
  });

  it.each([
    ['Not sent yet', 'sent'],
    ['Paused', 'sent'],
    ["Waiting: @api's last turn failed", 'sent'],
    ['Waiting for @fe', 'working'],
  ] as const)('does not offer Start anyway for "%s" while %s', (reason, state) => {
    renderRequest(post(1, { reason, state }));
    expect(buttons()).not.toContain('Start anyway');
  });

  it('draws the blob of each chat in the request, the receiver with the request state', () => {
    renderRequest(
      post(1, {
        fromUser: false,
        fromConversationId: FE_CHAT,
        fromHandle: 'fe',
        state: 'working',
      }),
    );
    const faces = [...screen.getByRole('listitem').querySelectorAll<HTMLElement>('.chat-face')];
    expect(faces.map((face) => face.dataset.expression)).toEqual(['idle', 'thinking']);
    expect(faces.every((face) => face.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('draws no blob for the user', () => {
    renderRequest(post(1));
    expect(screen.getByRole('listitem').querySelectorAll('.chat-face')).toHaveLength(1);
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

  it('offers no Answer while the chat waits on an approval card', () => {
    renderRequest(
      post(1, { state: 'needs_you', reason: '@api is waiting for your approval' }),
      false,
      false,
    );
    expect(buttons()).toEqual(['Cancel', 'Open in chat']);
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
        <NotePost
          post={note(2, { fromUser: false, fromConversationId: API_CHAT, fromHandle: 'api' })}
        />
      </ol>,
    );
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('@apinote');
    expect(item.querySelectorAll('.chat-face')).toHaveLength(1);
    expect(item.textContent).toContain('The contract is settled.');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('NoticeLine', () => {
  it('is one line of text', () => {
    render(
      <ol>
        <NoticeLine post={notice(3, 'Orders launch was paused.')} />
      </ol>,
    );
    const item = screen.getByRole('listitem');
    expect(item.textContent).toBe('Orders launch was paused.');
    expect(item.querySelector('.chat-face')).toBeNull();
  });

  it('introduces a member with its face, where it works and the task it was given', () => {
    const intro = { conversationId: API_CHAT, task: 'Task: Add an optional userId filter.' };
    render(
      <ol>
        <NoticeLine
          post={{ ...notice(3, '@api joined · api · Codex GPT-5 · Approve for me'), intro }}
        />
      </ol>,
    );
    const item = screen.getByRole('listitem');
    expect(item.querySelectorAll('.chat-face')).toHaveLength(1);
    expect(item.querySelector('.op-intro-line')?.textContent).toBe(
      '@api joined · api · Codex GPT-5 · Approve for me',
    );
    expect(item.querySelector('.op-intro-task')?.textContent).toBe(
      'Task: Add an optional userId filter.',
    );
  });

  it('has no task line for a member that was given none', () => {
    render(
      <ol>
        <NoticeLine
          post={{
            ...notice(3, '@fe joined · web'),
            intro: { conversationId: FE_CHAT, task: null },
          }}
        />
      </ol>,
    );
    expect(screen.getByRole('listitem').querySelector('.op-intro-task')).toBeNull();
  });
});
