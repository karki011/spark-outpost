// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client.ts';
import { phoneKeys } from '../phone/phone-api.ts';
import { SENT, calls, client, show, setUpOutpostView, view } from './outpost-view-harness.tsx';
import { API_CHAT, FE_CHAT, OUTPOST_ID, detail, post } from './test-fixtures.ts';

setUpOutpostView();

const overview = () => screen.getByRole('complementary', { name: 'Overview' });
const pane = () => screen.getByRole('complementary', { name: 'Thread with @api' });

function onPhone(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width: 640px'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function threads() {
  return [
    post(1, { state: 'answered', body: '@api Add the endpoint' }),
    post(2, { state: 'needs_you', body: '@api Pick a region', reason: 'eu or us?' }),
    post(3, {
      state: 'working',
      body: '@fe Build the page',
      toConversationId: FE_CHAT,
      toHandle: 'fe',
    }),
  ];
}

describe('the Overview pane', () => {
  it('groups threads under headings, the one waiting on the user first', () => {
    show(detail(threads()));
    view();
    const groups = within(overview()).getAllByRole('heading', { level: 3 });
    expect(groups.map((heading) => heading.textContent)).toEqual([
      'Waiting on you1',
      'Working1',
      'Idle1',
    ]);
    const waiting = within(overview()).getAllByRole('list')[0]!;
    expect(within(waiting).getByRole('button').textContent).toContain('Pick a region');
  });

  it('is an icon toggle that names what waits on the user, and a title menu item', () => {
    show(detail(threads()));
    view();
    const toggle = screen.getByRole('button', {
      name: 'Hide Overview. 1 thread waiting on you',
    });
    fireEvent.click(toggle);
    expect(screen.queryByRole('complementary', { name: 'Overview' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Usage by user' }));
    const item = screen.getByRole('menuitemcheckbox', { name: 'Show Overview' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(overview()).toBeTruthy();
  });

  it('shows the outpost’s pull requests and says Spark never merges', () => {
    const url = 'https://github.com/acme/shop/pull/12';
    show(
      detail([
        post(1, {
          state: 'answered',
          answer: { text: 'Done.', branch: 'spark/x', changes: [], pullRequests: [url] },
        }),
      ]),
    );
    view();
    fireEvent.click(within(overview()).getByRole('radio', { name: /Pull requests/ }));
    expect(
      within(overview())
        .getByRole('link', { name: /Pull request #12/ })
        .getAttribute('href'),
    ).toBe(url);
    expect(within(overview()).getByText(/Spark never merges/)).toBeTruthy();
  });
});

describe('a thread in the side pane', () => {
  it('opens from a card, goes back to Overview on Escape and returns focus to its row', async () => {
    show(detail(threads()));
    view();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open the thread with @api' })[0]!);
    const back = within(pane()).getByRole('button', { name: 'Back to Overview' });
    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(back, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Thread with @api' })).toBeNull();
    const row = within(overview()).getByRole('button', { name: /Add the endpoint/ });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('goes back on ⌘[ too', () => {
    show(detail(threads()));
    view();
    fireEvent.click(within(overview()).getByRole('button', { name: /Add the endpoint/ }));
    fireEvent.keyDown(within(pane()).getByRole('textbox'), { key: '[', metaKey: true });
    expect(screen.queryByRole('complementary', { name: 'Thread with @api' })).toBeNull();
  });

  it('sends what the user types to that chat as the user’s own message', async () => {
    const sendMessage = vi.spyOn(api, 'sendMessage').mockResolvedValue(SENT);
    show(detail(threads()));
    view();
    fireEvent.click(screen.getAllByRole('button', { name: 'Open the thread with @api' })[0]!);
    const box = within(pane()).getByRole('textbox', { name: 'Message @api' });
    expect(within(pane()).getByText('Sends to @api as you, as if typed in its chat.')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'Also add a test.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage.mock.calls[0]?.[0]).toBe(API_CHAT);
    expect(sendMessage.mock.calls[0]?.[2]).toBe('Also add a test.');
    expect(calls).toEqual([]);
  });

  it('answers there, as the user, a thread waiting on the user', () => {
    show(detail(threads()));
    view();
    fireEvent.click(within(overview()).getByRole('button', { name: /Pick a region/ }));
    expect(within(pane()).getByRole('textbox', { name: 'Answer @api' })).toBeTruthy();
  });

  it('on a paired device offers only Answer, never a message of its own', () => {
    client.setQueryData(phoneKeys.session, { remote: true, device: null, address: null });
    show(detail(threads()));
    view();
    fireEvent.click(within(overview()).getByRole('button', { name: /Add the endpoint/ }));
    expect(within(pane()).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(pane()).getByRole('button', { name: 'Back to Overview' }));
    fireEvent.click(within(overview()).getByRole('button', { name: /Pick a region/ }));
    expect(within(pane()).getByRole('textbox', { name: 'Answer @api' })).toBeTruthy();
  });
});

describe('on a phone', () => {
  it('switches between the conversation and Overview with one segmented control, and lists Overview in sections', () => {
    onPhone();
    show(detail(threads()));
    view();
    expect(screen.queryByRole('complementary', { name: 'Overview' })).toBeNull();
    const views = screen.getByRole('radiogroup', { name: 'Outpost view' });
    fireEvent.click(within(views).getByRole('radio', { name: 'Overview · 1 waiting' }));
    expect(overview()).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Outpost thread' })).toBeNull();
    expect(within(overview()).queryByRole('radiogroup')).toBeNull();
    expect(
      within(overview())
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Threads', 'Library', 'Pull requests']);
    fireEvent.click(within(overview()).getByRole('button', { name: /Add the endpoint/ }));
    expect(pane()).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Outpost view' })).toBeNull();
  });
});

describe('outpost instructions', () => {
  it('are edited from the title menu and saved for the outpost', async () => {
    show(detail([]));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Usage by user' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instructions…' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Instructions' }));
    expect(dialog.getByText(/They grant no permission/)).toBeTruthy();
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: '  Branch from main.  ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toEqual([
      {
        method: 'PUT',
        path: `/api/outposts/${OUTPOST_ID}/instructions`,
        body: { instructions: 'Branch from main.' },
      },
    ]);
  });

  it('are read-only on a paired device', () => {
    client.setQueryData(phoneKeys.session, { remote: true, device: null, address: null });
    show(detail([], { instructions: 'Branch from main.' }));
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Usage by user' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Instructions…' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Instructions' }));
    expect(dialog.getByRole('textbox').hasAttribute('readonly')).toBe(true);
    expect(dialog.getByText('Instructions are edited on your Mac.')).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
