// @vitest-environment jsdom
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCS_CHAT, OUTPOST_ID, WEB_PROJECT, chat } from '../test-fixtures.ts';
import { CreateSheet } from './CreateSheet.tsx';
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

afterEach(cleanup);

const INTO = {
  outpostId: OUTPOST_ID,
  name: 'Usage by user',
  members: [{ conversationId: DOCS_CHAT, handle: 'lead' }],
};

function story(): CreateDraft {
  const ids = countingIds();
  const lead = existing(ids, DOCS_CHAT, 'lead');
  const api = withTask(fresh(ids, API_PROJECT, 'api'), 'Add the endpoint.');
  const fe = withTask(fresh(ids, API_PROJECT, 'fe'), 'Call it.', api.key);
  const docs = withTask(fresh(ids, WEB_PROJECT, 'docs'), 'Document it.');
  return { ...storyDraft([lead, api, fe, docs], DOCS_CHAT), name: 'Orders launch' };
}

function Harness({
  initial,
  onStart,
}: {
  initial: CreateDraft;
  onStart?: (d: CreateDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const base = createData();
  const data = {
    ...base,
    chats: [...base.chats, chat(DOCS_CHAT, { title: 'Checkout plan', projectIds: [WEB_PROJECT] })],
  };
  return (
    <QueryClientProvider client={new QueryClient()}>
      <CreateSheet
        initial={initial}
        draft={draft}
        data={data}
        starting={false}
        failure={null}
        failed={null}
        onChange={setDraft}
        onStart={() => onStart?.(draft)}
        onOpenOutpost={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  );
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const marks = () =>
  [...document.querySelectorAll('.op-chat-row')].map(
    (row) => row.querySelector('.op-chat-after')?.textContent ?? '',
  );

function toChats() {
  fireEvent.keyDown(screen.getByRole('textbox', { name: /^Name/ }), { key: 'Enter' });
}

describe('the create sheet opened from a draft', () => {
  it('keeps the three steps and marks the chat each sub-task starts after', () => {
    render(<Harness initial={story()} />);
    expect(screen.getByRole('dialog', { name: 'New outpost' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ }).value).toBe(
      'Orders launch',
    );
    toChats();
    expect(marks()).toEqual(['', '', 'Starts after @api', '']);
  });

  it('changes what a sub-task starts after and its pull request from the chat form', () => {
    const onStart = vi.fn<(draft: CreateDraft) => void>();
    render(<Harness initial={story()} onStart={onStart} />);
    toChats();
    fireEvent.click(button('Edit New chat in web'));
    const form = screen.getByRole('group', { name: 'Chat 4' });
    expect(within(form).getByRole('button', { name: 'Starts after' }).textContent).toBe('Nothing');
    fireEvent.click(within(form).getByRole('button', { name: 'Starts after' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^@fe/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Pull request' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^No pull request/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Done' }));
    expect(marks()[3]).toBe('Starts after @fe');

    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start outpost/));
    const request = buildCreateRequest(OUTPOST_ID, onStart.mock.calls[0]![0]);
    const docs = request.members[3]!;
    expect(docs.dependsOn).toBe(
      request.members[2] && 'new' in request.members[2]
        ? request.members[2].new.conversationId
        : null,
    );
    expect('new' in docs ? docs.new.level : null).toBe('hands-off');
  });

  it('offers no story fields for the chat that proposed the draft', () => {
    render(<Harness initial={story()} />);
    toChats();
    fireEvent.click(button('Edit Checkout plan'));
    const form = screen.getByRole('group', { name: 'Chat 1' });
    expect(within(form).queryByRole('button', { name: 'Starts after' })).toBeNull();
    expect(within(form).queryByRole('button', { name: 'Pull request' })).toBeNull();
  });

  it('blocks Continue on chats that wait for each other and says so on the row', () => {
    const draft = story();
    const [lead, api, fe, docs] = draft.chats;
    const looped = { ...draft, chats: [lead!, { ...api!, dependsOn: fe!.key }, fe!, docs!] };
    render(<Harness initial={looped} />);
    toChats();
    expect(screen.getByText('These chats wait for each other: @api → @fe → @api.')).toBeTruthy();
    expect(button(/^Continue/).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('1 thing to fix')).toBeTruthy();
  });

  it('reviews the order, the stack and whose the first messages are', () => {
    render(<Harness initial={story()} />);
    toChats();
    fireEvent.click(button(/^Continue/));
    const review = screen.getByRole('region', { name: 'Review' });
    const lines = [...review.querySelectorAll('.op-review-order')].map((line) => line.textContent);
    expect(lines).toEqual([
      'Proposed these chats',
      'Starts right away · Pull request, parallel',
      'Starts after @api · stacked on its branch · Pull request, stacked on @api',
      'Starts right away · Pull request, parallel',
    ]);
    expect(within(review).getByText("First messages are sent as @lead's, not yours.")).toBeTruthy();
  });

  it('warns in review when a stacked chat would push before its parent', () => {
    const draft = story();
    const [lead, api, fe, docs] = draft.chats;
    const quiet = {
      ...draft,
      chats: [lead!, { ...api!, level: 'hands-off' as const }, fe!, docs!],
    };
    render(<Harness initial={quiet} />);
    toChats();
    fireEvent.click(button(/^Continue/));
    expect(
      screen.getByText(
        "@api opens no pull request, so @fe cannot push until @api's branch is pushed.",
      ),
    ).toBeTruthy();
  });
});

describe('the create sheet opened into an outpost', () => {
  function joining(): CreateDraft {
    const draft = story();
    return { ...draft, name: INTO.name, chats: draft.chats.slice(1), into: INTO };
  }

  it('opens on the chats with the name locked and adds the chats', () => {
    const onStart = vi.fn();
    render(<Harness initial={joining()} onStart={onStart} />);
    const dialog = screen.getByRole('dialog', { name: 'Add chats to Usage by user' });
    expect(within(dialog).getByRole('region', { name: 'Chats' }).hidden).toBe(false);
    expect(document.activeElement?.textContent).toBe('Add another chat');

    fireEvent.click(button('Back'));
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ });
    expect(name.readOnly).toBe(true);
    expect(
      screen.getByText('The new chats join this outpost. Rename it from its page.'),
    ).toBeTruthy();
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(button(/^Continue/));
    fireEvent.click(button(/^Start chats/));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('asks before discarding the chats, not an outpost', () => {
    render(<Harness initial={joining()} />);
    fireEvent.click(button('Remove New chat in web'));
    fireEvent.click(button('Close'));
    expect(screen.getByText('Discard these chats?')).toBeTruthy();
  });
});
