// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutpostPost, RequestState } from '@spark-outpost/contracts';
import { MessageRow } from './MessageRow.tsx';
import { NoticeLine } from './NoticeLine.tsx';
import { RequestCard } from './RequestCard.tsx';
import type { OutpostPull } from './outpost-pulls.ts';
import { threadCard } from './thread-cards.ts';
import { API_CHAT, FE_CHAT, note, notice, post } from './test-fixtures.ts';

afterEach(cleanup);

const PR_URL = 'https://github.com/acme/shop/pull/12';

function renderCard(request: OutpostPost, pulls: OutpostPull[] = [], answerable = true) {
  const handlers = {
    onOpenThread: vi.fn<(postId: string) => void>(),
    onAnswer: vi.fn<(postId: string) => void>(),
    onCancel: vi.fn<(postId: string) => void>(),
    onStartNow: vi.fn<(postId: string) => void>(),
  };
  render(
    <RequestCard
      card={threadCard(request, pulls)}
      selected={false}
      answerable={answerable}
      {...handlers}
    />,
  );
  return handlers;
}

function buttons(): string[] {
  return within(screen.getByRole('article'))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');
}

describe('RequestCard', () => {
  const cases: [RequestState, string, string[]][] = [
    ['sent', 'Queued', ['Open', 'Cancel…']],
    ['working', 'Working', ['Open', 'Stop…']],
    ['needs_you', 'Waiting on you', ['Answer', 'Open', 'Cancel…']],
    ['answered', 'Idle', ['Open']],
    ['failed', 'Failed', ['Open']],
    ['cancelled', 'Cancelled', ['Open']],
  ];

  it.each(cases)('shows %s as the word %s with the actions that fit', (state, word, actions) => {
    renderCard(post(1, { state }));
    expect(screen.getByText(word)).toBeTruthy();
    expect(buttons()).toEqual(actions);
  });

  it('is titled from the first line of the request, without the handle or Markdown marks', () => {
    renderCard(post(1, { body: '@api **Add** the `usage` endpoint\n\nMore detail.' }));
    expect(screen.getByRole('article').getAttribute('aria-label')).toBe(
      '@api: Add the usage endpoint. Queued',
    );
  });

  it('shows a short summary, then a git line that starts with the branch', () => {
    renderCard(
      post(1, {
        state: 'answered',
        answer: {
          text: 'Added the endpoint.',
          branch: 'spark/usage',
          changes: ['a.ts', 'b.ts'],
          pullRequests: [PR_URL],
          publish: { committed: false, pushed: true, reason: null },
        },
      }),
      [
        {
          url: PR_URL,
          number: 12,
          conversationId: API_CHAT,
          handle: 'api',
          postId: post(1).id,
          state: 'open',
        },
      ],
    );
    expect(screen.getByText('Added the endpoint.')).toBeTruthy();
    const git = screen.getByTitle('spark/usage').parentElement!;
    expect(git.textContent).toBe('spark/usage · Not committed · Pushed · 2 files · PR #12');
    expect(screen.getByText('Ready for review')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review PR' }).getAttribute('href')).toBe(PR_URL);
    cleanup();
    renderCard(
      post(1, {
        state: 'answered',
        answer: { text: 'It returns a list.', branch: null, changes: [], pullRequests: [] },
      }),
    );
    expect(screen.getByText('It returns a list.')).toBeTruthy();
    cleanup();
    renderCard(
      post(1, {
        state: 'answered',
        answer: { text: '', branch: 'spark/usage', changes: ['a.ts'], pullRequests: [] },
      }),
    );
    expect(screen.getByTitle('spark/usage').parentElement!.textContent).toBe(
      'spark/usage · 1 file',
    );
    cleanup();
    renderCard(
      post(1, {
        state: 'answered',
        answer: {
          text: 'Done.',
          branch: null,
          changes: ['a.ts'],
          pullRequests: [],
          publish: { committed: true, pushed: false, reason: null },
        },
      }),
    );
    expect(screen.getByText('Committed · Not pushed · 1 file').textContent).not.toMatch(/^ ·/);
  });

  it('puts who wrote a request from another chat in its name and tooltip, not on its face', () => {
    renderCard(post(1, { fromUser: false, fromHandle: 'fe', fromConversationId: FE_CHAT }));
    const card = screen.getByRole('article');
    expect(card.getAttribute('aria-label')).toContain(
      'Written by @fe, not from you. It is not your request to push or open a pull request.',
    );
    expect(card.getAttribute('title')).toContain('Written by @fe');
    expect(card.textContent).not.toContain('not from you');
  });

  it('says nothing about provenance for a request the user wrote', () => {
    renderCard(post(1));
    expect(screen.getByRole('article').getAttribute('title')).toBeNull();
  });

  it('asks before it stops a working request, and keeps it on Keep', () => {
    const handlers = renderCard(post(1, { state: 'working' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop the request to @api…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(handlers.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop the request to @api…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(handlers.onCancel).toHaveBeenCalledWith(post(1).id);
  });

  it('offers Start anyway on a held request and opens its thread', () => {
    const handlers = renderCard(post(1, { held: true, reason: 'Waiting for @fe' }));
    expect(screen.getByText('Held')).toBeTruthy();
    expect(screen.getByText('Waiting for @fe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start the request to @api anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the thread with @api' }));
    expect(handlers.onStartNow).toHaveBeenCalledWith(post(1).id);
    expect(handlers.onOpenThread).toHaveBeenCalledWith(post(1).id);
  });

  it('offers no Answer while the chat waits on an approval card', () => {
    renderCard(post(1, { state: 'needs_you' }), [], false);
    expect(buttons()).toEqual(['Open', 'Cancel…']);
  });

  it('marks a request to a chat outside the outpost as guest', () => {
    renderCard(post(1, { guest: true }));
    expect(within(screen.getByRole('article')).getByText('guest')).toBeTruthy();
  });

  it('offers no way into a chat that was deleted', () => {
    renderCard(post(1, { state: 'failed', reason: 'Chat deleted', toConversationId: null }));
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

describe('MessageRow', () => {
  it('says who asked whom, and once that a request from another chat is not from you', () => {
    const asked = post(1, { fromUser: false, fromHandle: 'fe', fromConversationId: FE_CHAT });
    render(
      <ol>
        <MessageRow post={asked} targets={['api']} body={asked.body} createdAt={asked.createdAt} />
      </ol>,
    );
    const head = screen.getByRole('listitem').querySelector('.op-post-head');
    expect(head?.textContent).toContain('@fe');
    expect(head?.textContent).toContain('to@api');
    expect(head?.querySelector('.op-nfy')?.textContent).toBe('not from you');
  });

  it('names Spark as the writer of a story wrap-up', () => {
    const wrapUp = post(1, { fromUser: false, fromSpark: true });
    render(
      <ol>
        <MessageRow post={wrapUp} body={wrapUp.body} createdAt={wrapUp.createdAt} />
      </ol>,
    );
    expect(screen.getByText('Spark')).toBeTruthy();
    expect(screen.getByText('not from you')).toBeTruthy();
  });

  it('draws a note as Markdown, marked as a note, with no actions', () => {
    const written = note(2, { body: 'Use **v2** of `orders`.' });
    render(
      <ol>
        <MessageRow post={written} body={written.body} createdAt={written.createdAt} />
      </ol>,
    );
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('note');
    expect(item.querySelector('strong')?.textContent).toBe('v2');
    expect(item.querySelector('code')?.textContent).toBe('orders');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('says how many files went with a request', () => {
    const asked = post(1, { files: 2 });
    render(
      <ol>
        <MessageRow post={asked} body={asked.body} createdAt={asked.createdAt} />
      </ol>,
    );
    expect(screen.getByText('2 files')).toBeTruthy();
  });
});

describe('NoticeLine', () => {
  it('is one line of text', () => {
    render(
      <ol>
        <NoticeLine post={notice(3, 'Orders launch was paused.')} />
      </ol>,
    );
    expect(screen.getByRole('listitem').textContent).toBe('Orders launch was paused.');
  });

  it('introduces a member with its face, where it works and the task it was given', () => {
    const intro = { conversationId: API_CHAT, task: 'Task: Add an optional userId filter.' };
    render(
      <ol>
        <NoticeLine
          post={{ ...notice(3, '@api joined · api · Codex GPT-5 · Auto review'), intro }}
        />
      </ol>,
    );
    const item = screen.getByRole('listitem');
    expect(item.querySelectorAll('.chat-face')).toHaveLength(1);
    expect(item.querySelector('.op-intro-task')?.textContent).toBe(
      'Task: Add an optional userId filter.',
    );
  });
});
