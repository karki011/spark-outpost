// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { calls, setUpOutpostView, show, view } from './outpost-view-harness.tsx';
import { OUTPOST_ID, detail, note, postId } from './test-fixtures.ts';

setUpOutpostView();

describe('pinning a note', () => {
  it('asks the server to pin a note from its row', async () => {
    show(detail([note(1, { body: 'Ship Friday.' })]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Pin note' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/outposts/${OUTPOST_ID}/posts/${postId(1)}/pin`,
      body: { pinned: true },
    });
  });

  it('offers Unpin on a pinned note and sends the opposite', async () => {
    show(detail([note(1, { body: 'Ship Friday.', pinnedAt: '2026-10-09T10:05:00.000Z' })]));
    view();
    const button = screen.getByRole('button', { name: 'Unpin note' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    await waitFor(() => expect(calls[0]?.body).toMatchObject({ pinned: false }));
  });

  it('collapses the pinned notes to a count and lists their first lines when opened', () => {
    show(
      detail([
        note(1, { body: 'Ship Friday.\nMore detail.', pinnedAt: '2026-10-09T10:05:00.000Z' }),
        note(2, { body: 'Not pinned.' }),
        note(3, { body: 'Docs live in /docs.', pinnedAt: '2026-10-09T10:06:00.000Z' }),
      ]),
    );
    view();
    const toggle = screen.getByRole('button', { name: /^Pinned · 2$/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Pinned notes' })).toBeNull();
    fireEvent.click(toggle);
    const list = screen.getByRole('list', { name: 'Pinned notes' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Ship Friday.', 'Docs live in /docs.']);
  });

  it('shows no pinned bar when nothing is pinned', () => {
    show(detail([note(1)]));
    view();
    expect(screen.queryByRole('button', { name: /^Pinned/ })).toBeNull();
  });
});
