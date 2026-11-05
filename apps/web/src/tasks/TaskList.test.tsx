// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskListItem } from '@spark-outpost/contracts';
import { TaskList, WaitingItems } from './TaskList.tsx';

afterEach(cleanup);

const GREP = "git grep -l -i 'AI_USER' -- apps/web/src packages/contracts/src";

const waitingCommand: TaskListItem = {
  id: 'waiting:00000000-0000-4000-8000-0000000000d2',
  label: `Waiting for you: ${GREP}`,
  state: 'waiting',
  command: true,
};

const ranCommand: TaskListItem = {
  id: 'waiting:00000000-0000-4000-8000-0000000000d3',
  label: `GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 ${GREP}`,
  state: 'done',
  command: true,
  detail: 'Allowed: Yes',
};

describe('commands in the Work panel', () => {
  it('sum up a waiting command the way the message box does', () => {
    render(<WaitingItems items={[waitingCommand]} roots={[]} />);
    const waiting = screen.getByRole('list', { name: 'Waiting for you' });
    const label = within(waiting).getByText(/^Approve/);
    expect(label.textContent).toBe("Approve git grep -l -i 'AI_USER' …");
    expect(label.getAttribute('title')).toBe(GREP);
  });

  it('shorten a finished command row and keep the full text, without secrets, on expand', () => {
    localStorage.clear();
    render(<TaskList items={[ranCommand]} roots={[]} />);
    const row = screen.getByRole('button', { name: /git grep/ });
    expect(row.querySelector('.ti-t')?.textContent).toBe(
      "git grep -l -i 'AI_USER' -- apps/web/src …",
    );
    fireEvent.click(row);
    const full = document.querySelector('.ti-full')!.textContent!;
    expect(full).toContain(GREP);
    expect(full).not.toContain('ghp_');
  });
});
