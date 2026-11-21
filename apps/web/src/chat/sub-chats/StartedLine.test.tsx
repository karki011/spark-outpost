// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubChatsStart } from '@spark-outpost/contracts';
import { OpenSubChatsContext, StartedLines } from './StartedLine.tsx';

afterEach(cleanup);

const RUN = '44444444-4444-4444-8444-444444444444';
const OTHER_RUN = '55555555-5555-4555-8555-555555555555';

const START: SubChatsStart = {
  runId: RUN,
  subChats: [
    { id: '22222222-2222-4222-8222-222222222222', title: 'Payments API', held: false },
    { id: '33333333-3333-4333-8333-333333333333', title: 'E2E tests', held: true },
  ],
  notStarted: [{ title: 'Docs', reason: 'Its project folder is missing.' }],
};

describe('the line under the turn that started sub-chats', () => {
  it('names the sub-chats, the held ones and the ones that did not start, and opens the tab', () => {
    const open = vi.fn();
    render(
      <OpenSubChatsContext value={open}>
        <StartedLines starts={[START]} runIds={[RUN]} />
      </OpenSubChatsContext>,
    );
    expect(screen.getByText('Started 2 sub-chats: Payments API, E2E tests')).toBeTruthy();
    expect(screen.getByText('Held until what they wait for has reported: E2E tests')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(
      'Not started: Docs. Its project folder is missing.',
    );
    const link = screen.getByRole('button', { name: 'Open the Sub-chats tab' });
    expect(link.textContent).toBe('Sub-chats ›');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledOnce();
  });

  it('shows nothing under another turn', () => {
    const { container } = render(<StartedLines starts={[START]} runIds={[OTHER_RUN]} />);
    expect(container.textContent).toBe('');
  });

  it('says only what did not start when nothing did', () => {
    render(<StartedLines starts={[{ ...START, subChats: [] }]} runIds={[RUN]} />);
    expect(screen.queryByText(/^Started/)).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
