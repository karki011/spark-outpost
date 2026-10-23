// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_CHAT, FE_CHAT, OUTPOST_ID, WEB_PROJECT, chat } from '../test-fixtures.ts';
import type { CreateDraft } from './create-draft.ts';
import {
  API_PROJECT,
  countingIds,
  createData,
  existing,
  fresh,
  storyDraft,
  withTask,
} from './create-fixtures.ts';
import { buildCreateRequest } from './create-request.ts';
import { DraftSheet } from './DraftSheet.tsx';

afterEach(cleanup);

const INTO = {
  outpostId: OUTPOST_ID,
  name: 'Usage by user',
  members: [{ conversationId: DOCS_CHAT, handle: 'lead' }],
};
const LONG_TASK = `Document the usage page. ${'Cover each column and filter. '.repeat(8)}`;

function story(): CreateDraft {
  const ids = countingIds();
  const lead = existing(ids, DOCS_CHAT, 'lead');
  const api = withTask(fresh(ids, API_PROJECT, 'api'), 'Add the endpoint.');
  const fe = withTask(fresh(ids, API_PROJECT, 'fe'), 'Call it.', api.key);
  const docs = withTask(fresh(ids, WEB_PROJECT, 'docs'), LONG_TASK);
  return { ...storyDraft([lead, api, fe, docs], DOCS_CHAT), name: 'Orders launch' };
}

function joining(): CreateDraft {
  const draft = story();
  return { ...draft, name: INTO.name, chats: draft.chats.slice(1), into: INTO };
}

interface HarnessProps {
  initial: CreateDraft;
  onStart?: (draft: CreateDraft) => void;
  onClose?: () => void;
}

function Harness({ initial, onStart, onClose = vi.fn() }: HarnessProps) {
  const [draft, setDraft] = useState(initial);
  const base = createData();
  const data = {
    ...base,
    chats: [...base.chats, chat(DOCS_CHAT, { title: 'Checkout plan', projectIds: [WEB_PROJECT] })],
  };
  return (
    <QueryClientProvider client={new QueryClient()}>
      <DraftSheet
        initial={initial}
        draft={draft}
        data={data}
        starting={false}
        failure={null}
        failed={null}
        onChange={setDraft}
        onStart={() => onStart?.(draft)}
        onOpenOutpost={vi.fn()}
        onClose={onClose}
      />
    </QueryClientProvider>
  );
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const cards = () => [...document.querySelectorAll('.op-draft-card')];
const orders = () =>
  cards().map((card) => card.querySelector('.op-draft-order')?.textContent ?? 'lead');

describe('the sheet for a draft a chat proposed', () => {
  it('shows every chat in full on one sheet and starts the new outpost from the default button', () => {
    const onStart = vi.fn();
    render(<Harness initial={story()} onStart={onStart} />);
    const dialog = screen.getByRole('dialog', { name: 'Start a new outpost with 3 new chats' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(dialog.textContent).toContain("First messages are sent as @lead's, not yours.");
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Outpost name' }).value).toBe(
      'Orders launch',
    );
    expect(cards()[0]?.textContent).toContain('Proposing chat');
    expect(screen.queryByRole('button', { name: 'Edit Checkout plan' })).toBeNull();
    expect(orders()).toEqual([
      'lead',
      'Starts right awayPull request, parallel',
      'Starts after @apistacked on its branchPull request, stacked on @api',
      'Starts right awayPull request, parallel',
    ]);
    expect(screen.getByText('Add the endpoint.')).toBeTruthy();

    const start = button('Start outpost');
    expect(document.activeElement).toBe(start);
    expect(start.querySelector('.keys')).toBeNull();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows a chat the lead named as an existing chat that gets a request', () => {
    const ids = countingIds();
    const lead = existing(ids, DOCS_CHAT, 'lead');
    const api = withTask(fresh(ids, API_PROJECT, 'api'), 'Add the endpoint.');
    const old = withTask(existing(ids, FE_CHAT, 'usage'), 'Use the endpoint.', api.key);
    render(
      <Harness initial={{ ...storyDraft([lead, api, old], DOCS_CHAT), name: 'Orders launch' }} />,
    );
    const card = cards()[2];
    expect(card?.querySelector('.op-tag')?.textContent).toBe('Existing chat · gets a request');
    expect(card?.querySelector('.op-draft-label')?.textContent).toBe('Request');
    expect(card?.querySelector('.op-draft-order')?.textContent).toBe(
      'Starts after @apiorder only, it keeps its own branch',
    );
  });

  it('clamps a long first message until Show all', () => {
    render(<Harness initial={story()} />);
    const toggle = button('Show all');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.className).toBe(
      'clamped',
    );
    fireEvent.click(toggle);
    expect(button('Show less').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: /^Show (all|less)$/ })).toHaveLength(1);
  });

  it('edits a chat in place and keeps its new order and pull request', () => {
    const onStart = vi.fn<(draft: CreateDraft) => void>();
    render(<Harness initial={story()} onStart={onStart} />);
    fireEvent.click(button('Edit New chat in web'));
    const form = screen.getByRole('group', { name: 'Chat 4' });
    fireEvent.click(within(form).getByRole('button', { name: 'Starts after' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^@fe/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Pull request' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^No pull request/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Done' }));
    expect(orders()[3]).toBe('Starts after @fedifferent repo, order onlyNo pull request');

    fireEvent.click(button('Start outpost'));
    const request = buildCreateRequest(OUTPOST_ID, onStart.mock.calls[0]![0]);
    const [, , fe, docs] = request.members;
    expect(docs?.dependsOn).toBe(fe && 'new' in fe ? fe.new.conversationId : null);
    expect(docs && 'new' in docs ? docs.new.level : null).toBe('hands-off');
  });

  it('keeps the sheet open when Escape closes a menu inside it', () => {
    const onClose = vi.fn();
    render(<Harness initial={story()} onClose={onClose} />);
    fireEvent.click(button('Edit New chat in web'));
    const anchor = screen.getByRole('button', { name: 'Starts after' });
    fireEvent.click(anchor);
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Starts after' });
    fireEvent.keyDown(within(menu).getAllByRole('menuitemradio')[0]!, { key: 'Escape' });
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('dialog', { name: /^Start a new outpost/ })).toBeTruthy();
    expect(screen.queryByText('Discard this outpost?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks Start on chats that wait for each other and says why on the card', () => {
    const draft = story();
    const [lead, api, fe, docs] = draft.chats;
    const looped = { ...draft, chats: [lead!, { ...api!, dependsOn: fe!.key }, fe!, docs!] };
    render(<Harness initial={looped} />);
    expect(screen.getByText('These chats wait for each other: @api → @fe → @api.')).toBeTruthy();
    expect(button('Start outpost').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('1 thing to fix')).toBeTruthy();
  });

  it('warns on the card when a stacked chat would push before its parent', () => {
    const draft = story();
    const [lead, api, fe, docs] = draft.chats;
    const quiet = {
      ...draft,
      chats: [lead!, { ...api!, level: 'hands-off' as const }, fe!, docs!],
    };
    render(<Harness initial={quiet} />);
    expect(
      screen.getByText(
        "@api opens no pull request, so @fe cannot push until @api's branch is pushed.",
      ),
    ).toBeTruthy();
  });

  it('asks for a name before it starts a new outpost', () => {
    const onStart = vi.fn();
    render(<Harness initial={{ ...story(), name: '' }} onStart={onStart} />);
    const name = screen.getByRole('textbox', { name: 'Outpost name' });
    expect(document.activeElement).toBe(name);
    fireEvent.keyDown(name, { key: 'Enter', metaKey: true });
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a name.')).toBeTruthy();
  });
});

describe('the sheet for a draft into an outpost', () => {
  it('names the outpost and starts the chats with Start N chats', () => {
    const onStart = vi.fn();
    render(<Harness initial={joining()} onStart={onStart} />);
    screen.getByRole('dialog', { name: 'Start 3 chats in Usage by user' });
    expect(screen.queryByRole('textbox', { name: 'Outpost name' })).toBeNull();
    expect(screen.getByText('3 new chats · in Usage by user')).toBeTruthy();
    fireEvent.keyDown(button('Start 3 chats'), { key: 'Enter', metaKey: true });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding the chats on Escape, and Escape again keeps editing', () => {
    const onClose = vi.fn();
    render(<Harness initial={joining()} onClose={onClose} />);
    fireEvent.click(button('Remove New chat in web'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: /^Start 2 chats/ }), { key: 'Escape' });
    expect(screen.getByText('Discard these chats?')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', { name: /^Start 2 chats/ }), { key: 'Escape' });
    expect(screen.queryByText('Discard these chats?')).toBeNull();
    fireEvent.click(button('Cancel'));
    fireEvent.click(button('Discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
