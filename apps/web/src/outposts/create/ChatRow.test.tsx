// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_PROJECT, countingIds, file, fresh } from './create-fixtures.ts';
import type { ChatProblem } from './create-problems.ts';
import { ChatRow } from './ChatRow.tsx';

afterEach(cleanup);

const VIEW = {
  faceId: '0c000000-0000-4000-8000-000000000009',
  title: 'New chat in api',
  tag: 'New' as const,
  meta: 'api · Codex GPT-5 · Auto review',
};

function renderRow(problems: ChatProblem[] = [], text = '') {
  const chat = { ...fresh(countingIds(), API_PROJECT, 'api'), text, files: [file(1), file(2)] };
  const actions = { onHandle: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn() };
  render(<ChatRow chat={chat} view={VIEW} problems={problems} {...actions} />);
  return actions;
}

describe('ChatRow', () => {
  it('shows the face, handle, kind, place and the first-message mark with its file count', () => {
    renderRow([], 'Add the filter.');
    const row = document.querySelector('.op-chat-row')!;

    expect(row.querySelector('.chat-face')).not.toBeNull();
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Handle for New chat in api' }).value,
    ).toBe('api');
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('api · Codex GPT-5 · Auto review')).toBeTruthy();
    expect(row.querySelector('.op-chat-mark')?.textContent).toBe('First message2 files');
  });

  it('has no first-message mark for a chat without one', () => {
    renderRow();
    expect(document.querySelector('.op-chat-mark')).toBeNull();
  });

  it('edits the handle, opens the form and removes the chat', () => {
    const actions = renderRow();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'backend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit New chat in api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove New chat in api' }));

    expect(actions.onHandle).toHaveBeenCalledWith('backend');
    expect(actions.onEdit).toHaveBeenCalledTimes(1);
    expect(actions.onRemove).toHaveBeenCalledTimes(1);
  });

  it('ties a handle problem to the input and applies a suggested handle', () => {
    const problem: ChatProblem = {
      key: 'k',
      field: 'handle',
      message: 'Two chats cannot share @api.',
      suggestions: ['api2', 'limits'],
    };
    const actions = renderRow([problem]);
    const input = screen.getByRole('textbox');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Two chats cannot share @api. Try @api2 or @limits',
    );
    fireEvent.click(screen.getByRole('button', { name: '@limits' }));
    expect(actions.onHandle).toHaveBeenCalledWith('limits');
  });
});
