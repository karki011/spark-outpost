// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { calls, setUpOutpostView, show, view } from './outpost-view-harness.tsx';
import { canRetry } from './post-text.ts';
import { API_CHAT, OUTPOST_ID, detail, post } from './test-fixtures.ts';

setUpOutpostView();

describe('canRetry', () => {
  it('is for a failed or cancelled request the user wrote, with nothing attached', () => {
    expect(canRetry(post(1, { state: 'failed' }))).toBe(true);
    expect(canRetry(post(1, { state: 'cancelled' }))).toBe(true);
    expect(canRetry(post(1, { state: 'working' }))).toBe(false);
    expect(canRetry(post(1, { state: 'answered' }))).toBe(false);
    expect(canRetry(post(1, { state: 'failed', fromUser: false, fromHandle: 'fe' }))).toBe(false);
    expect(canRetry(post(1, { state: 'failed', fromSpark: true }))).toBe(false);
    expect(canRetry(post(1, { state: 'failed', files: 1 }))).toBe(false);
    expect(canRetry(post(1, { state: 'failed', toConversationId: null }))).toBe(false);
  });
});

describe('Retry on a request card', () => {
  it('posts a new request to the same chat with the same text, as the user', async () => {
    show(detail([post(1, { state: 'failed', body: 'Add an optional userId filter.' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Retry the request to @api' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/outposts/${OUTPOST_ID}/posts`,
      body: { text: 'Add an optional userId filter.', toConversationId: API_CHAT },
    });
    expect(calls[0]?.body).not.toHaveProperty('to');
  });

  it('is offered on a cancelled request and not on a running or answered one', () => {
    show(
      detail([
        post(1, { state: 'cancelled' }),
        post(2, { state: 'working' }),
        post(3, { state: 'answered' }),
      ]),
    );
    view();
    expect(screen.getAllByRole('button', { name: 'Retry the request to @api' })).toHaveLength(1);
  });

  it('is not offered for a request a chat wrote, which is never re-sent as the user’s', () => {
    show(detail([post(1, { state: 'failed', fromUser: false, fromHandle: 'fe' })]));
    view();
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();
  });
});
