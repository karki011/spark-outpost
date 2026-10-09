// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FailedMember } from '@spark-outpost/contracts';
import { API_CHAT, FE_CHAT } from '../test-fixtures.ts';
import { CreateSheet } from './CreateSheet.tsx';
import { emptyChat, type CreateDraft } from './create-draft.ts';
import {
  API_PROJECT,
  CODEX,
  createData,
  draftOf,
  existing,
  countingIds,
} from './create-fixtures.ts';
import { buildCreateRequest } from './create-request.ts';

afterEach(cleanup);

interface HarnessProps {
  initial?: CreateDraft;
  failed?: FailedMember[] | null;
  onStart?: (draft: CreateDraft) => void;
  onClose?: () => void;
  onOpenOutpost?: () => void;
}

function Harness({ initial, failed = null, onStart, onClose, onOpenOutpost }: HarnessProps) {
  const [first] = useState(() => initial ?? draftOf([emptyChat(CODEX)], ''));
  const [draft, setDraft] = useState(first);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <button type="button">Opener</button>
      <CreateSheet
        initial={first}
        draft={draft}
        data={createData()}
        starting={false}
        failure={null}
        failed={failed}
        onChange={setDraft}
        onStart={() => onStart?.(draft)}
        onOpenOutpost={onOpenOutpost ?? vi.fn()}
        onClose={onClose ?? vi.fn()}
      />
    </QueryClientProvider>
  );
}

const dialog = () => screen.getByRole('dialog', { name: 'New outpost' });
const nameInput = () => screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ });
const currentStep = () =>
  within(dialog()).getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')
    ?.textContent;
const button = (name: string | RegExp) => within(dialog()).getByRole('button', { name });

function pickChat(title: string) {
  fireEvent.click(button('Chat'));
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${title}`) }));
}

function pressEnter(target: Element, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(target, { key: 'Enter', ...init });
}

function nameIt(name = 'Usage by user') {
  fireEvent.change(nameInput(), { target: { value: name } });
  pressEnter(nameInput());
}

describe('the steps to a new outpost', () => {
  it('opens on the name, and Enter moves on only when there is one', () => {
    render(<Harness />);
    expect(document.activeElement).toBe(nameInput());
    expect(currentStep()).toContain('Name');

    pressEnter(nameInput());
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(currentStep()).toContain('Name');

    nameIt();
    expect(currentStep()).toContain('Chats');
    expect(document.activeElement).toBe(button('Chat'));
  });

  it('adds two existing chats and starts by keyboard alone', () => {
    const onStart = vi.fn<(draft: CreateDraft) => void>();
    render(<Harness onStart={onStart} />);
    nameIt();

    pickChat('Usage page');
    const add = button('Add another chat');
    expect(document.activeElement).toBe(add);
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Handle for Usage page' }).value,
    ).toBe('web');

    fireEvent.click(add);
    expect(document.activeElement).toBe(button('Chat'));
    pickChat('Rate limit headers');
    expect(within(dialog()).getByText('2 chats')).toBeTruthy();

    pressEnter(document.activeElement!, { metaKey: true });
    expect(currentStep()).toContain('Review');
    const start = button(/^Start outpost/);
    expect(document.activeElement).toBe(start);

    fireEvent.click(start);
    expect(buildCreateRequest('id', onStart.mock.calls[0]![0]).members).toEqual([
      { conversationId: FE_CHAT, handle: 'web' },
      { conversationId: API_CHAT, handle: 'api' },
    ]);
  });

  it('offers each chat once and says why a Terminal session cannot join', () => {
    render(<Harness />);
    nameIt();
    pickChat('Usage page');
    fireEvent.click(button('Add another chat'));
    fireEvent.click(button('Chat'));
    const titles = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
    expect(titles.some((title) => title?.startsWith('Usage page'))).toBe(false);
  });

  it('ignores an empty form on Continue and keeps what was typed when going back', () => {
    render(<Harness />);
    nameIt('Orders');
    fireEvent.click(button(/^Continue/));
    expect(currentStep()).toContain('Review');
    expect(
      within(dialog()).getByText('No chats yet. You can add them after the outpost starts.'),
    ).toBeTruthy();

    fireEvent.click(button('Back'));
    expect(currentStep()).toContain('Chats');
    fireEvent.click(button('Add a chat'));
    pickChat('Usage page');
    fireEvent.click(button('Back'));
    expect(nameInput().value).toBe('Orders');
    pressEnter(nameInput());
    expect(screen.getByRole('textbox', { name: 'Handle for Usage page' })).toBeTruthy();
  });

  it('blocks Continue with a reason while a new chat has no project, then adds the open chat', () => {
    render(<Harness />);
    nameIt();
    fireEvent.click(screen.getByRole('radio', { name: 'New chat' }));
    const proceed = button(/^Continue/);
    expect(proceed).toHaveProperty('disabled', false);

    fireEvent.change(screen.getByRole('textbox', { name: 'Handle' }), { target: { value: 'api' } });
    expect(proceed).toHaveProperty('disabled', true);
    expect(within(dialog()).getByText('1 thing to fix')).toBeTruthy();
    expect(within(dialog()).getByText('A new chat needs a project.')).toBeTruthy();
    expect(button('Add chat')).toHaveProperty('disabled', true);

    fireEvent.click(button('Project'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^api/ }));
    expect(proceed).toHaveProperty('disabled', false);
    expect(within(dialog()).getByText('Continue adds the open chat')).toBeTruthy();

    pressEnter(screen.getByRole('textbox', { name: 'Handle' }));
    expect(currentStep()).toContain('Chats');
    expect(screen.getByRole('textbox', { name: 'Handle for New chat in api' })).toBeTruthy();
    expect(document.activeElement).toBe(button('Add another chat'));
  });

  it('suggests other handles when two chats share one', () => {
    const ids = countingIds();
    const initial = draftOf([existing(ids, FE_CHAT, 'api'), existing(ids, API_CHAT, 'api')]);
    render(<Harness initial={initial} />);
    pressEnter(nameInput());

    expect(within(dialog()).getByText(/Two chats cannot share @api\./)).toBeTruthy();
    expect(button(/^Continue/)).toHaveProperty('disabled', true);
    fireEvent.click(button('@api2'));
    expect(button(/^Continue/)).toHaveProperty('disabled', false);
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Handle for Rate limit headers' })
        .value,
    ).toBe('api2');
  });

  it('reviews the chats, their first messages and what starting does', () => {
    const ids = countingIds();
    const api = {
      ...existing(ids, API_CHAT, 'api'),
      kind: 'new' as const,
      projectId: API_PROJECT,
      text: 'Add an optional userId filter.',
    };
    render(<Harness initial={draftOf([existing(ids, FE_CHAT, 'fe'), api])} />);
    pressEnter(nameInput());
    fireEvent.click(button(/^Continue/));

    const review = within(dialog()).getByRole('region', { name: 'Review' });
    expect(within(review).getByText('Usage by user')).toBeTruthy();
    expect(within(review).getByText('@fe')).toBeTruthy();
    expect(within(review).getByText('New chat in api')).toBeTruthy();
    expect(within(review).getByText('api · Codex Auto · Approve for me')).toBeTruthy();
    expect(within(review).getByText('Add an optional userId filter.')).toBeTruthy();
    expect(within(review).getByText('Creates 1 new chat')).toBeTruthy();
    expect(within(review).getByText('Sends 1 first request')).toBeTruthy();
    expect(within(review).getByText('Each chat works under its own mode.')).toBeTruthy();

    fireEvent.click(within(review).getByRole('button', { name: 'Edit name' }));
    expect(document.activeElement).toBe(nameInput());
  });
});

describe('closing the sheet', () => {
  it('closes at once when nothing was typed', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(nameInput(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding typed input, and Escape keeps editing', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.change(nameInput(), { target: { value: 'Usage' } });

    fireEvent.click(button('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('Discard this outpost?')).toBeTruthy();
    expect(document.activeElement).toBe(button('Keep editing'));

    fireEvent.keyDown(button('Keep editing'), { key: 'Escape' });
    expect(within(dialog()).queryByText('Discard this outpost?')).toBeNull();
    expect(nameInput().value).toBe('Usage');

    fireEvent.click(button('Close'));
    fireEvent.click(button('Discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('a start that left a chat out', () => {
  it('says which chat failed and why, and offers to try again or open the outpost', () => {
    const onStart = vi.fn();
    const onOpenOutpost = vi.fn();
    const ids = countingIds();
    const failed = [
      {
        conversationId: API_CHAT,
        handle: 'api',
        message: 'Connect this provider before using it in a chat.',
      },
    ];
    render(
      <Harness
        initial={draftOf([existing(ids, FE_CHAT, 'fe')])}
        failed={failed}
        onStart={onStart}
        onOpenOutpost={onOpenOutpost}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe(
      'Usage by user started. 1 thing did not work.',
    );
    expect(within(dialog()).getByText('@api')).toBeTruthy();
    expect(
      within(dialog()).getByText('Connect this provider before using it in a chat.'),
    ).toBeTruthy();
    fireEvent.click(button(/^Try again/));
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.click(button('Open outpost'));
    expect(onOpenOutpost).toHaveBeenCalledTimes(1);
  });
});
