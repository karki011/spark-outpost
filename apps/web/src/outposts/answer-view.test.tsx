// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { OutpostAnswer, OutpostPost } from '@spark-outpost/contracts';
import { RequestPost } from './RequestPost.tsx';
import { post } from './test-fixtures.ts';

afterEach(cleanup);

const NOTES_PATH = `/private/tmp/${'scratch-folder/'.repeat(20)}NOTES.md`;

function answer(text: string): OutpostAnswer {
  return { text, branch: null, changes: [], pullRequests: [] };
}

function renderRequest(request: OutpostPost) {
  const ignore = () => undefined;
  render(
    <ol>
      <RequestPost
        post={request}
        answering={false}
        answerable
        onAnswer={ignore}
        onCancel={ignore}
        onOpenChat={ignore}
      />
    </ol>,
  );
}

const item = () => document.querySelector<HTMLElement>('.op-post')!;

describe('an answer written in Markdown', () => {
  it('draws code, emphasis and lists instead of their marks', () => {
    renderRequest(
      post(1, {
        state: 'answered',
        answer: answer('Added `NOTES.md` with **one** line.\n\n- first\n- second'),
      }),
    );

    expect(item().querySelector('.op-reply code')?.textContent).toBe('NOTES.md');
    expect(item().querySelector('.op-reply strong')?.textContent).toBe('one');
    expect(item().querySelectorAll('.op-reply li')).toHaveLength(2);
    expect(item().querySelector('.op-reply')?.textContent).not.toContain('`');
  });

  it('shows a file link as its name, not as a web link, the way a chat reply does', () => {
    renderRequest(
      post(1, { state: 'answered', answer: answer(`Added [NOTES.md](${NOTES_PATH}).`) }),
    );

    const reply = item().querySelector('.op-reply');
    expect(reply?.textContent).toContain('Added NOTES.md.');
    expect(reply?.textContent).not.toContain('/private/tmp');
    expect(reply?.querySelector('.md-link-off')?.textContent).toBe('NOTES.md');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens a web link in a new tab', () => {
    renderRequest(
      post(1, { state: 'answered', answer: answer('See [the docs](https://example.com/docs).') }),
    );

    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('does not offer to show more when only a hidden link target is long', () => {
    renderRequest(
      post(1, { state: 'answered', answer: answer(`Added [NOTES.md](${NOTES_PATH}).`) }),
    );

    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('collapses a long answer and opens it on demand', () => {
    renderRequest(
      post(1, { state: 'answered', answer: answer('one\n\ntwo\n\nthree\n\nfour\n\nfive') }),
    );

    const toggle = screen.getByRole('button', { name: 'Show all of the answer' });
    const text = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(text?.className).toContain('clamped');
    fireEvent.click(toggle);
    expect(text?.className).not.toContain('clamped');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the Markdown the user typed in the request', () => {
    renderRequest(post(1, { body: 'Keep `this` and **that** as typed.' }));

    expect(item().querySelector('code')?.textContent).toBe('this');
    expect(item().querySelector('strong')?.textContent).toBe('that');
    expect(item().textContent).not.toContain('**');
  });
});

describe('a request that needs you', () => {
  const waiting = post(1, {
    state: 'needs_you',
    reason: 'Send the new filename, including its extension.',
    answer: answer(
      'What would you like to rename `NOTES.md` to?\n\nNeeds you: Send the new filename, including its extension.',
    ),
  });

  it('says what it needs once, with the question beside it', () => {
    renderRequest(waiting);

    expect(screen.getAllByText(/Send the new filename, including its extension\./)).toHaveLength(1);
    expect(item().querySelector('.op-reason')?.textContent).toBe(
      'Send the new filename, including its extension.',
    );
    expect(item().querySelector('.op-reply')?.textContent).toContain(
      'What would you like to rename NOTES.md to?',
    );
    expect(item().textContent).not.toContain('Needs you:');
  });

  it('shows no empty question when the reply was only what it needs', () => {
    renderRequest(
      post(1, {
        state: 'needs_you',
        reason: 'which region?',
        answer: answer('Needs you: which region?'),
      }),
    );

    expect(screen.getAllByText('which region?')).toHaveLength(1);
    expect(item().querySelector('.op-reply .op-text')).toBeNull();
    expect(item().querySelector('.op-reply')?.textContent).toContain('is waiting for you');
  });
});

describe('a request the user answered on the way', () => {
  const answered = post(1, {
    state: 'answered',
    exchanges: [
      {
        question:
          'What would you like to rename `NOTES.md` to?\n\nNeeds you: Send the new filename.',
        answer: 'RENAMED.md',
      },
    ],
    answer: answer('Renamed `NOTES.md` to `RENAMED.md`.'),
  });

  it('keeps the question and the user’s answer above the final answer', () => {
    renderRequest(answered);

    const asked = item().querySelector('.op-asked');
    expect(asked?.textContent).toContain('@api');
    expect(asked?.textContent).toContain('asked');
    expect(asked?.textContent).toContain('What would you like to rename NOTES.md to?');
    expect(asked?.querySelector('.op-reason')?.textContent).toBe('Send the new filename.');
    expect(asked?.textContent).toContain('You');
    expect(asked?.textContent).toContain('RENAMED.md');
    expect(asked?.textContent).not.toContain('Needs you:');
    const reply = item().querySelector('.op-reply');
    expect(reply?.textContent).toContain('Renamed NOTES.md to RENAMED.md.');
    expect(asked?.compareDocumentPosition(reply!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps every round in order and stays while the chat works on', () => {
    renderRequest(
      post(1, {
        state: 'working',
        exchanges: [
          { question: 'Needs you: pick v1 or v2.', answer: 'v2' },
          { question: 'Needs you: confirm the field name.', answer: 'orderId' },
        ],
      }),
    );

    const rounds = [...item().querySelectorAll('.op-asked')].map((round) => round.textContent);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toContain('pick v1 or v2.');
    expect(rounds[0]).toContain('v2');
    expect(rounds[1]).toContain('confirm the field name.');
    expect(rounds[1]).toContain('orderId');
  });

  it('renders the Markdown in the user’s answer', () => {
    renderRequest(
      post(1, {
        state: 'answered',
        exchanges: [{ question: 'Needs you: a name.', answer: 'use `a` and _b_' }],
      }),
    );

    const round = item().querySelector('.op-asked')!;
    expect(round.querySelector('code')?.textContent).toBe('a');
    expect(round.querySelector('em')?.textContent).toBe('b');
  });

  it('adds nothing to a request that was never asked anything', () => {
    renderRequest(post(1, { state: 'answered', answer: answer('Done.') }));

    expect(item().querySelector('.op-asked')).toBeNull();
  });
});
