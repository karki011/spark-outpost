// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueueStrip } from './QueueStrip.tsx';
import type { ChatQueue } from './use-chat-queue.ts';

afterEach(cleanup);

it('shows image-only queued messages and permits keeping their text empty when editing', () => {
  const edit = vi.fn();
  const queue: ChatQueue = {
    items: [
      {
        id: 'item-a',
        content: '',
        attachmentIds: ['file-a'],
        position: 1,
        continueRunId: null,
        createdAt: '2026-10-28T12:00:00Z',
      },
    ],
    add: vi.fn(),
    edit,
    remove: vi.fn(),
    move: vi.fn(),
    sendNow: vi.fn(),
    sendFirst: vi.fn(),
    error: null,
  };
  render(<QueueStrip queue={queue} mode="waiting" />);
  expect(screen.getByText('1 attachment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(edit).toHaveBeenCalledWith('item-a', '');
});
