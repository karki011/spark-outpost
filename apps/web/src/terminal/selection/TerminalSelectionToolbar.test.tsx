// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TerminalSelection } from './follow-selection.ts';
import { TerminalSelectionToolbar } from './TerminalSelectionToolbar.tsx';
import { useTerminalSelection, type TerminalSelectionState } from './use-terminal-selection.ts';

const fake = vi.hoisted(() => ({
  queueDraft: vi.fn(),
  requestChat: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock('../../api/client.ts', () => ({ newDraftId: () => 'draft-chat' }));
vi.mock('../../app/chat-request.ts', () => ({ requestChat: fake.requestChat }));
vi.mock('../../chat/composer/pending-draft.ts', () => ({ queueDraft: fake.queueDraft }));

const target = {
  insertSelection: vi.fn(() => true),
  clearSelection: vi.fn(),
  focus: vi.fn(),
};
let state: TerminalSelectionState;

function Harness() {
  const current = useTerminalSelection();
  useEffect(() => {
    state = current;
  });
  return (
    <div>
      <TerminalSelectionToolbar state={current} />
      <textarea aria-label="Terminal input" />
    </div>
  );
}

const box = { left: 10, top: 10, right: 20, bottom: 30 };
const selected = (text: string, canInsert = true): TerminalSelection => ({
  text,
  start: box,
  end: box,
  canInsert,
});
const names = () => screen.getAllByRole('button').map((button) => button.textContent);

async function select(selection: TerminalSelection) {
  act(() => state.report(selection, 'select'));
  await screen.findByRole('button', { name: 'Copied' });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: fake.writeText },
  });
  render(<Harness />);
  act(() => state.attach(target));
});

afterEach(cleanup);

it('copies a settled selection and offers the terminal options', async () => {
  expect(screen.queryByRole('toolbar')).toBeNull();
  await select(selected('pnpm check'));
  expect(fake.writeText).toHaveBeenCalledExactlyOnceWith('pnpm check');
  expect(names()).toEqual([
    'Add to terminal',
    'Ask about this',
    'Comment',
    'New chat with this',
    'Copied',
  ]);
});

it('shows Copy until the clipboard has the text, and copies again on request', async () => {
  fake.writeText.mockRejectedValueOnce(new Error('not focused'));
  act(() => state.report(selected('pnpm check'), 'select'));
  const copy = await screen.findByRole('button', { name: 'Copy' });
  fireEvent.click(copy);
  await screen.findByRole('button', { name: 'Copied' });
  expect(fake.writeText).toHaveBeenCalledTimes(2);
});

it('leaves focus in the terminal when an option is pressed', async () => {
  const input = screen.getByRole('textbox', { name: 'Terminal input' });
  input.focus();
  await select(selected('pnpm check'));
  expect(document.activeElement).toBe(input);
  const pressed = fireEvent.mouseDown(screen.getByRole('button', { name: 'Ask about this' }));
  expect(pressed).toBe(false);
  expect(document.activeElement).toBe(input);
});

it('adds the selection to the terminal and closes', async () => {
  await select(selected('pnpm check'));
  fireEvent.click(screen.getByRole('button', { name: 'Add to terminal' }));
  expect(target.insertSelection).toHaveBeenCalledWith('add', 'pnpm check', '');
  expect(target.clearSelection).toHaveBeenCalled();
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('adds the selection with the shortcut, and only while it is offered', async () => {
  const shortcut = { code: 'KeyA', key: 'A', shiftKey: true, ctrlKey: true, metaKey: true };
  const terminal = () => screen.getByRole('textbox', { name: 'Terminal input' });
  fireEvent.keyDown(terminal(), shortcut);
  expect(target.insertSelection).not.toHaveBeenCalled();
  await select(selected('last output', false));
  fireEvent.keyDown(terminal(), shortcut);
  expect(target.insertSelection).not.toHaveBeenCalled();
  await select(selected('pnpm check'));
  const elsewhere = document.body.appendChild(document.createElement('input'));
  fireEvent.keyDown(elsewhere, shortcut);
  elsewhere.remove();
  expect(target.insertSelection).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(terminal(), shortcut)).toBe(false);
  expect(target.insertSelection).toHaveBeenCalledExactlyOnceWith('add', 'pnpm check', '');
});

it('asks about the selection', async () => {
  await select(selected('error TS2322'));
  fireEvent.click(screen.getByRole('button', { name: 'Ask about this' }));
  expect(target.insertSelection).toHaveBeenCalledWith('ask', 'error TS2322', '');
});

it('adds a typed note with the selection', async () => {
  await select(selected('error TS2322'));
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  const note = screen.getByRole('textbox', { name: 'Note on the selected text' });
  expect(document.activeElement).toBe(note);
  fireEvent.change(note, { target: { value: 'fix this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(target.insertSelection).toHaveBeenCalledWith('comment', 'error TS2322', 'fix this');
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('keeps an open note through scrolling output and closes it with Escape', async () => {
  await select(selected('error TS2322'));
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  act(() => state.report(null, 'scroll'));
  const note = screen.getByRole('textbox', { name: 'Note on the selected text' });
  fireEvent.keyDown(note, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Note on the selected text' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
  expect(target.focus).toHaveBeenCalled();
  expect(target.insertSelection).not.toHaveBeenCalled();
});

it('hides when the selection clears, on scroll, on typing and on resize', async () => {
  for (const cause of ['select', 'scroll', 'input', 'resize'] as const) {
    await select(selected(`pnpm check ${cause}`));
    act(() => state.report(null, cause));
    expect(screen.queryByRole('toolbar')).toBeNull();
  }
});

it('offers only Copy and a new chat for a session that cannot take input', async () => {
  await select(selected('last output', false));
  expect(names()).toEqual(['New chat with this', 'Copied']);
});

it('opens a new chat with the selection quoted in its message box', async () => {
  await select(selected('error TS2322\nat line 4', false));
  fireEvent.click(screen.getByRole('button', { name: 'New chat with this' }));
  expect(fake.queueDraft).toHaveBeenCalledWith('draft-chat', '> error TS2322\n> at line 4\n\n');
  expect(fake.requestChat).toHaveBeenCalledWith('draft-chat');
  await waitFor(() => expect(screen.queryByRole('toolbar')).toBeNull());
});

it('moves between the options with the arrow keys', async () => {
  await select(selected('pnpm check'));
  const buttons = screen.getAllByRole('button');
  buttons[0]!.focus();
  fireEvent.keyDown(buttons[0]!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(buttons[1]);
  fireEvent.keyDown(buttons[1]!, { key: 'End' });
  expect(document.activeElement).toBe(buttons.at(-1));
  fireEvent.keyDown(buttons.at(-1)!, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(buttons[0]);
});

it('follows a selection that output moved without copying again or closing the note', async () => {
  await select(selected('pnpm check'));
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  const note = screen.getByRole('textbox', { name: 'Note on the selected text' });
  fireEvent.change(note, { target: { value: 'why?' } });
  act(() => state.report({ ...selected('pnpm check'), start: { ...box, top: 0 } }, 'update'));
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Note on the selected text' }).value,
  ).toBe('why?');
  expect(fake.writeText).toHaveBeenCalledTimes(1);
});

it('withdraws the terminal options when the session ends under an open toolbar', async () => {
  await select(selected('pnpm check'));
  act(() => state.report(selected('pnpm check', false), 'update'));
  expect(names()).toEqual(['New chat with this', 'Copied']);
});

it('closes an open note when the session ends', async () => {
  await select(selected('pnpm check'));
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  act(() => state.report(selected('pnpm check', false), 'update'));
  expect(screen.queryByRole('textbox', { name: 'Note on the selected text' })).toBeNull();
  expect(names()).toEqual(['New chat with this', 'Copied']);
});

it('keeps an open note and inserts the copied text after output replaced the selected rows', async () => {
  await select(selected('pnpm check'));
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  act(() => state.report(null, 'changed'));
  const note = screen.getByRole('textbox', { name: 'Note on the selected text' });
  fireEvent.change(note, { target: { value: 'why?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(target.insertSelection).toHaveBeenCalledExactlyOnceWith('comment', 'pnpm check', 'why?');
});

it('closes the toolbar when output replaced the selected rows and no note is open', async () => {
  await select(selected('pnpm check'));
  act(() => state.report(null, 'changed'));
  expect(screen.queryByRole('toolbar')).toBeNull();
});
