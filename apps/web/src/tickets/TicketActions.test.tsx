// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveMenu } from './MoveMenu.tsx';
import { TicketComment } from './TicketComment.tsx';
import { ticketKeys, ticketsApi } from './tickets-api.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return invalidate;
}

const invalidatedKeys = (spy: ReturnType<typeof show>) =>
  spy.mock.calls.map(([filters]) => filters?.queryKey);

describe('TicketComment', () => {
  const comment = () => <TicketComment source="jira" ticketKey="WEB-1" sourceName="Jira" />;

  it('posts with the keyboard, clears the box and refreshes only the inbox and the ticket', async () => {
    const post = vi.spyOn(ticketsApi, 'comment').mockResolvedValue({ ok: true });
    const invalidate = show(comment());
    const box = screen.getByRole('textbox', { name: 'Comment on WEB-1' });
    fireEvent.change(box, { target: { value: 'Looks good' } });
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true, ctrlKey: true });

    await waitFor(() => expect(post).toHaveBeenCalledWith('jira', 'WEB-1', { body: 'Looks good' }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
    expect(invalidatedKeys(invalidate)).toEqual([
      ticketKeys.inbox,
      ticketKeys.view('jira', 'WEB-1'),
    ]);
  });

  it('keeps the text and shows the error when posting fails', async () => {
    vi.spyOn(ticketsApi, 'comment').mockRejectedValue(new Error('Jira said no.'));
    show(comment());
    const box = screen.getByRole('textbox', { name: 'Comment on WEB-1' });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      "Couldn't post the comment. Jira said no.",
    );
    expect((box as HTMLTextAreaElement).value).toBe('Hello');
  });

  it('disables posting while empty or in flight', async () => {
    let finish: (value: { ok: boolean }) => void = () => undefined;
    vi.spyOn(ticketsApi, 'comment').mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show(comment());
    const button = screen.getByRole('button', { name: 'Comment' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Posting…' })).toBeTruthy());
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    finish({ ok: true });
  });
});

describe('MoveMenu', () => {
  const menu = () => (
    <MoveMenu source="linear" ticketKey="ENG-4" current="todo" sourceName="Linear" />
  );
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Move ENG-4 in Linear' }));
    return screen.getByRole('menu', { name: 'Move ENG-4 in Linear' });
  };

  it('lists the other statuses and moves, refreshing only the inbox and the ticket', async () => {
    const move = vi
      .spyOn(ticketsApi, 'transition')
      .mockResolvedValue({ outcome: 'succeeded', message: null });
    const invalidate = show(menu());
    const list = open();
    expect(
      within(list)
        .getAllByRole('menuitemradio')
        .map((item) => item.textContent),
    ).toEqual(['In progress', 'In review', 'Done']);
    fireEvent.click(within(list).getByRole('menuitemradio', { name: 'In progress' }));

    await waitFor(() => expect(move).toHaveBeenCalledWith('linear', 'ENG-4', 'in_progress'));
    await waitFor(() =>
      expect(invalidatedKeys(invalidate)).toEqual([
        ticketKeys.inbox,
        ticketKeys.view('linear', 'ENG-4'),
      ]),
    );
  });

  it('says why when the move was skipped and refreshes nothing', async () => {
    vi.spyOn(ticketsApi, 'transition').mockResolvedValue({
      outcome: 'skipped',
      message: 'No finished status.',
    });
    const invalidate = show(menu());
    fireEvent.click(within(open()).getByRole('menuitemradio', { name: 'Done' }));

    expect((await screen.findByRole('alert')).textContent).toBe('No finished status.');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('shows a failed request', async () => {
    vi.spyOn(ticketsApi, 'transition').mockRejectedValue(new Error('Linear is down.'));
    show(menu());
    fireEvent.click(within(open()).getByRole('menuitemradio', { name: 'Done' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Linear is down.');
  });
});
