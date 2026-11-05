// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutpostComposer } from './OutpostComposer.tsx';
import type { Answering, ComposerTarget } from './composer-target.ts';
import { API_CHAT, FE_CHAT, memberView, postId } from './test-fixtures.ts';

const MEMBERS = [
  memberView(FE_CHAT, 'fe', { title: 'Usage page' }),
  memberView(API_CHAT, 'api', { title: 'Usage endpoint' }),
];
const ANSWERING: Answering = { postId: postId(1), conversationId: FE_CHAT, handle: 'fe' };

type Send = (target: ComposerTarget, text: string, id: string) => Promise<unknown>;

class QuietResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', QuietResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function composer(
  options: {
    answering?: Answering | null;
    paused?: boolean;
    onSend?: Send;
    fill?: { id: number; text: string } | null;
  } = {},
  onCancelAnswer = vi.fn<() => void>(),
) {
  return (
    <OutpostComposer
      members={MEMBERS}
      answering={options.answering ?? null}
      paused={options.paused ?? false}
      fill={options.fill ?? null}
      onCancelAnswer={onCancelAnswer}
      onSend={options.onSend ?? vi.fn<Send>(() => Promise.resolve())}
    />
  );
}

function box(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>('combobox', {
    name: /Message the outpost|Answer @/,
  });
}

function type(text: string, caret = text.length): void {
  fireEvent.change(box(), { target: { value: text, selectionStart: caret, selectionEnd: caret } });
}

function choose(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Message destination' }));
  fireEvent.click(
    screen.getByRole('menuitemradio', {
      name: label === 'Post note' ? /^Post note/ : label,
    }),
  );
}

function asks(): string[] {
  const line = screen.queryByRole('group', { name: 'Chats this message asks' });
  return [...(line?.querySelectorAll('.op-ask') ?? [])].map((chip) => chip.textContent ?? '');
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', {
    name: /^(Send message|Send request|Post note|Send answer)$/,
  });
}

describe('OutpostComposer', () => {
  it('uses the story lead, allows another agent, and retains that choice after sending', async () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    render(
      <OutpostComposer
        members={MEMBERS}
        leadConversationId={API_CHAT}
        answering={null}
        paused={false}
        onCancelAnswer={() => undefined}
        onSend={onSend}
      />,
    );
    type('where are we');
    fireEvent.click(sendButton());
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      toConversationId: API_CHAT,
      body: 'where are we',
    });
    await act(async () => {});
    choose('@fe');
    type('next step');
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1]?.[0]).toMatchObject({ toConversationId: FE_CHAT });
    expect(screen.getByRole('button', { name: 'Message destination' }).textContent).toContain(
      '@fe',
    );
  });

  it('keeps the draft and blocks when an explicitly selected member disappears', () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    const props = { answering: null, paused: false, onCancelAnswer: () => undefined, onSend };
    const { rerender } = render(<OutpostComposer {...props} members={MEMBERS} />);
    choose('@api');
    type('unfinished thought');
    rerender(<OutpostComposer {...props} members={[MEMBERS[0]!]} />);
    expect(box().value).toBe('unfinished thought');
    expect(sendButton().disabled).toBe(true);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('uses the first active member when the story lead is unavailable', () => {
    render(
      <OutpostComposer
        members={[{ ...MEMBERS[0]!, archived: true }, MEMBERS[1]!]}
        leadConversationId={FE_CHAT}
        answering={null}
        paused={false}
        onCancelAnswer={() => undefined}
        onSend={vi.fn<Send>()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Message destination' }).textContent).toContain(
      'Lead · @api',
    );
    type('status');
    expect(sendButton().disabled).toBe(false);
  });

  it('never routes explicit notes even when they mention all agents', () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    render(composer({ onSend }));
    choose('Post note');
    type('@all remember this');
    fireEvent.click(sendButton());
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      action: 'note',
      to: [],
      body: '@all remember this',
    });
    expect(onSend.mock.calls[0]?.[0]).not.toHaveProperty('toConversationId');
  });

  it('is one message box whose button says what the text will do', () => {
    render(composer());
    expect(box()).toBeTruthy();
    expect(sendButton().textContent).toBe('Send message');
    expect(sendButton().disabled).toBe(true);
    type('The contract is settled');
    expect(sendButton().textContent).toBe('Send message');
    expect(sendButton().disabled).toBe(false);
    type('@api add the filter');
    expect(sendButton().textContent).toBe('Send request');
    expect(asks()).toEqual(['@api']);
  });

  it('acknowledges a saved note and prepares an explicit request without sending it', async () => {
    let finish!: () => void;
    const onSend = vi.fn<Send>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(composer({ onSend }));
    choose('Post note');
    type('where are we');
    expect(screen.getByText('Note only · No agent will reply.')).toBeTruthy();
    fireEvent.click(sendButton());
    expect(screen.getByRole('status').textContent).toBe('Saving note…');
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ action: 'note', to: [] });
    await act(async () => finish());
    expect(screen.getByRole('status').textContent).toBe('Note saved · No agent was asked.');
    fireEvent.click(screen.getByRole('button', { name: 'Ask all' }));
    expect(box().value).toBe('@all where are we');
    expect(asks()).toEqual(['@fe', '@api']);
    expect(document.activeElement).toBe(box());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers explicit targeting before a note is posted and restores skipped recipients', () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    render(composer({ onSend }));
    type('@all status');
    fireEvent.click(screen.getByRole('button', { name: 'Do not ask @fe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Do not ask @api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask all' }));
    expect(asks()).toEqual(['@fe', '@api']);
    expect(box().value).toBe('@all status');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not replace newer typing with a late note receipt', async () => {
    let finish!: () => void;
    render(
      composer({
        onSend: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      }),
    );
    choose('Post note');
    type('first note');
    fireEvent.click(sendButton());
    type('next message');
    await act(async () => finish());
    expect(box().value).toBe('next message');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lists every chat a message will ask, wherever its handle is typed', () => {
    render(composer());
    type('could @api list the fields so that @fe can draw them?');
    expect(asks()).toEqual(['@api', '@fe']);
    expect(sendButton().textContent).toBe('Send request');
    type('@all rebase on main');
    expect(asks()).toEqual(['@fe', '@api']);
    type('mail someone@api.dev about it');
    expect(asks()).toEqual([]);
    expect(sendButton().textContent).toBe('Send message');
  });

  it('leaves a chat out when its name is removed, and sends who is left', async () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    const text = '@fe draw what @api returns';
    render(composer({ onSend }));
    type(text);
    fireEvent.click(screen.getByRole('button', { name: 'Do not ask @api' }));
    expect(asks()).toEqual(['@fe']);
    expect(box().value).toBe(text);
    expect(document.activeElement).toBe(box());
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ action: 'request', to: ['fe'] });
    expect(onSend.mock.calls[0]?.[1]).toBe(text);
  });

  it('blocks when every chat is left out, and asks a chat again when it is typed again', () => {
    render(composer());
    type('thanks @api');
    fireEvent.click(screen.getByRole('button', { name: 'Do not ask @api' }));
    expect(asks()).toEqual([]);
    expect(sendButton().textContent).toBe('Send message');
    expect(
      screen.getByText('No recipients selected. Restore a recipient or choose Post note.'),
    ).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    type('thanks');
    type('thanks @api');
    expect(asks()).toEqual(['@api']);
  });

  it('sends on Enter, clears the box, and keeps a new line on Shift+Enter', async () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    render(composer({ onSend }));
    type('@api add the filter');
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ action: 'request', to: ['api'] });
    expect(onSend.mock.calls[0]?.[1]).toBe('@api add the filter');
    expect(box().value).toBe('');
  });

  it.each([false, true])(
    'retries the original agent after routing changes, newer draft=%s',
    async (newer) => {
      let reject!: (error: Error) => void;
      const onSend = vi
        .fn<Send>()
        .mockImplementationOnce(
          () =>
            new Promise((_, fail) => {
              reject = fail;
            }),
        )
        .mockResolvedValue(undefined);
      const props = { answering: null, paused: false, onCancelAnswer: () => undefined, onSend };
      const { rerender } = render(
        <OutpostComposer {...props} members={MEMBERS} leadConversationId={FE_CHAT} />,
      );
      type('original request');
      fireEvent.click(sendButton());
      choose('Post note');
      if (newer) type('new note draft');
      fireEvent.keyDown(box(), { key: 'Enter' });
      expect(onSend).toHaveBeenCalledTimes(1);
      rerender(<OutpostComposer {...props} members={MEMBERS} leadConversationId={API_CHAT} />);
      await act(async () => reject(new Error('Offline')));
      expect(box().value).toBe(newer ? 'new note draft' : '');
      expect(screen.getByText('Unsent to @fe: original request')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
      expect(onSend.mock.calls[1]).toEqual(onSend.mock.calls[0]);
      expect(onSend.mock.calls[1]?.[2]).toEqual(expect.any(String));
      expect(onSend.mock.calls[1]?.[0]).toMatchObject({ toConversationId: FE_CHAT });
      expect(box().value).toBe(newer ? 'new note draft' : '');
      expect(screen.getByRole('button', { name: 'Message destination' }).textContent).toContain(
        'Post note',
      );
    },
  );

  it('keeps a failed note separate from an agent draft and allows explicit discard', async () => {
    const onSend = vi.fn<Send>().mockRejectedValue(new Error('Offline'));
    render(composer({ onSend }));
    choose('Post note');
    type('@all reference only');
    fireEvent.click(sendButton());
    choose('@api');
    type('new request');
    await screen.findByRole('alert');
    expect(box().value).toBe('new request');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(onSend.mock.calls[1]).toEqual(onSend.mock.calls[0]);
    expect(onSend.mock.calls[1]?.[2]).toEqual(expect.any(String));
    expect(onSend.mock.calls[1]?.[0]).toMatchObject({ action: 'note', to: [] });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Discard unsent message' }).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard unsent message' }));
    expect(box().value).toBe('new request');
    expect(sendButton().disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers member handles while one is typed at the start and fills in the pick', () => {
    render(composer());
    type('@');
    const options = screen
      .getAllByRole('option')
      .filter((option) => option.closest('[role=listbox]'));
    expect(options.map((option) => option.textContent)).toEqual([
      '@feUsage page',
      '@apiUsage endpoint',
    ]);
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(box().getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(box().value).toBe('@api ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('narrows the handles as they are typed and closes the list on Escape', () => {
    render(composer());
    type('@a');
    expect(
      screen
        .getAllByRole('option')
        .filter((option) => option.closest('[role=listbox]'))
        .map((option) => option.textContent),
    ).toEqual(['@apiUsage endpoint']);
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box().value).toBe('@a');
  });

  it('offers handles wherever an @ is typed and completes the one at the caret', () => {
    render(composer());
    type('tell @ about the shape', 6);
    expect(
      screen.getAllByRole('option').filter((option) => option.closest('[role=listbox]')),
    ).toHaveLength(2);
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(box().value).toBe('tell @api about the shape');
    expect(box().selectionStart).toBe(10);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(asks()).toEqual(['@api']);
  });

  it('sends on Enter when the message ends with a whole handle', async () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    render(composer({ onSend }));
    type('thanks @fe');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(box(), { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ action: 'request', to: ['fe'] });
  });

  it('offers nothing for an @ inside a word', () => {
    render(composer());
    type('mail someone@a');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('answers the selected request from the same box', async () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    const onCancelAnswer = vi.fn<() => void>();
    render(composer({ answering: ANSWERING, onSend }, onCancelAnswer));
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByText('Answering').textContent).toBe('Answering @fe');
    expect(document.activeElement).toBe(box());
    type('@api light theme');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(sendButton().textContent).toBe('Send answer');
    expect(screen.getByText('Goes to @fe as your message')).toBeTruthy();
    fireEvent.click(sendButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({
      action: 'answer',
      to: ['fe'],
      body: '@api light theme',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop answering @fe' }));
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(onCancelAnswer).toHaveBeenCalledTimes(2);
  });

  it('moves focus to the box when a request is picked to answer', () => {
    const { rerender } = render(composer());
    expect(document.activeElement).not.toBe(box());
    rerender(composer({ answering: ANSWERING }));
    expect(document.activeElement).toBe(box());
  });

  it('says a request waits while the outpost is paused', () => {
    render(composer({ paused: true }));
    type('@api add the filter');
    expect(screen.getByText('Paused. @api gets this when you resume.')).toBeTruthy();
    expect(sendButton().disabled).toBe(false);
    type('@api and @fe add the filter');
    expect(screen.getByText('Paused. They get this when you resume.')).toBeTruthy();
  });

  it('sends to everyone at once with @all', async () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    render(composer({ onSend }));
    type('@all agree the endpoint');
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Enter' });
      await Promise.resolve();
    });
    expect(onSend.mock.calls[0]?.[0]).toMatchObject({ action: 'request', to: ['fe', 'api'] });
    expect(box().value).toBe('');
  });

  it('takes a message it is handed, focused and ready to send, and takes the next one too', () => {
    const onSend = vi.fn<Send>(() => Promise.resolve());
    const first = '@fe merge spark/api-1 into your branch.';
    const { rerender } = render(composer({ onSend }));
    type('half a thought');
    rerender(composer({ onSend, fill: { id: 1, text: first } }));
    expect(box().value).toBe(first);
    expect(document.activeElement).toBe(box());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(sendButton().textContent).toBe('Send request');
    expect(onSend).not.toHaveBeenCalled();

    type('changed by hand');
    rerender(composer({ onSend, fill: { id: 1, text: first } }));
    expect(box().value).toBe('changed by hand');
    rerender(composer({ onSend, fill: { id: 2, text: first } }));
    expect(box().value).toBe(first);
  });
});
