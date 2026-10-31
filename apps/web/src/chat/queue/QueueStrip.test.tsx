// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '@spark-outpost/contracts';
import { ApiError } from '../../api/client.ts';
import { QueueStrip } from './QueueStrip.tsx';
import type { ChatQueue } from './use-chat-queue.ts';

afterEach(cleanup);

function item(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id: 'item-a',
    content: 'Rename the flag',
    position: 1,
    continueRunId: null,
    createdAt: '2026-10-28T12:00:00Z',
    ...overrides,
  };
}

function chatQueue(overrides: Partial<ChatQueue> = {}): ChatQueue {
  return {
    items: [item()],
    add: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
    move: vi.fn(),
    sendNow: vi.fn(),
    sendFirst: vi.fn(),
    error: null,
    ...overrides,
  };
}

it('shows image-only queued messages and permits keeping their text empty when editing', () => {
  const queue = chatQueue({ items: [item({ content: '', attachmentIds: ['file-a'] })] });
  render(<QueueStrip queue={queue} mode="waiting" />);
  expect(screen.getByText('1 attachment')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(queue.edit).toHaveBeenCalledWith('item-a', '');
});

it('keeps an edit that lost the race with the queue, so it can be queued again', async () => {
  const sent = new ApiError(404, 'That message has already been sent.');
  const queue = chatQueue({ edit: vi.fn().mockRejectedValue(sent) });
  const view = render(<QueueStrip queue={queue} mode="waiting" />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit queued message' }), {
    target: { value: 'Rename the flag and the test' },
  });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));

  view.rerender(<QueueStrip queue={{ ...queue, items: [] }} mode="waiting" />);
  expect(screen.getByRole('alert').textContent).toContain('sent before your edit was saved');
  const kept = screen.getByRole('textbox', { name: 'Unsaved edit' }) as HTMLTextAreaElement;
  expect(kept.value).toBe('Rename the flag and the test');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Queue' })));
  expect(queue.add).toHaveBeenCalledWith('Rename the flag and the test');
  expect(screen.queryByRole('textbox', { name: 'Unsaved edit' })).toBeNull();
});

it('says why a kept edit could not be queued again and keeps it', async () => {
  const sent = new ApiError(404, 'That message has already been sent.');
  const queue = chatQueue({
    edit: vi.fn().mockRejectedValue(sent),
    add: vi.fn().mockRejectedValue(new ApiError(409, 'The queue holds 50 messages.')),
  });
  const view = render(<QueueStrip queue={queue} mode="waiting" />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
  view.rerender(<QueueStrip queue={{ ...queue, items: [] }} mode="waiting" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Queue' })));
  const alerts = screen.getAllByRole('alert').map((alert) => alert.textContent);
  expect(alerts).toContain('The queue holds 50 messages.');
  expect(screen.getByRole('textbox', { name: 'Unsaved edit' })).toBeTruthy();
});

it('keeps no copy of an edit that failed for another reason', async () => {
  const queue = chatQueue({ edit: vi.fn().mockRejectedValue(new ApiError(0, 'Offline')) });
  render(<QueueStrip queue={queue} mode="waiting" />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save' })));
  expect(screen.queryByRole('textbox', { name: 'Unsaved edit' })).toBeNull();
});
