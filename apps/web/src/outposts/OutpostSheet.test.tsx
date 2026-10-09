// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { OutpostSheet } from './OutpostSheet.tsx';
import { EMPTY_FORM, type SheetForm } from './sheet-draft.ts';
import { API_CHAT, DOCS_CHAT, FE_CHAT, OUTPOST_ID, WEB_PROJECT, chat } from './test-fixtures.ts';

type Start = (form: SheetForm) => Promise<unknown>;

const CHATS = [
  chat(FE_CHAT, { title: 'Usage page', projectIds: [WEB_PROJECT], branch: 'spark/usage' }),
  chat(API_CHAT, { title: 'Usage endpoint' }),
  chat(DOCS_CHAT, { title: 'Shell', sessionType: 'terminal' }),
];
const FORM: SheetForm = {
  name: 'Usage by user',
  members: [
    { conversationId: FE_CHAT, handle: 'fe' },
    { conversationId: API_CHAT, handle: 'api' },
  ],
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Opener(props: {
  initial?: SheetForm;
  onStart?: Start;
  onDelete?: () => Promise<unknown>;
  canManage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New outpost
      </button>
      {open && (
        <OutpostSheet
          mode={props.onDelete ? 'edit' : 'create'}
          initial={props.initial ?? EMPTY_FORM}
          chats={CHATS}
          projectNames={{ [WEB_PROJECT]: 'web' }}
          outpostId={props.onDelete ? OUTPOST_ID : null}
          canManage={props.canManage ?? true}
          onStart={props.onStart ?? vi.fn<Start>(() => Promise.resolve())}
          {...(props.onDelete ? { onDelete: props.onDelete } : {})}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function openSheet(): HTMLElement {
  const opener = screen.getByRole('button', { name: 'New outpost' });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

function nameInput(): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: /^Name/ });
}

describe('OutpostSheet', () => {
  it('opens as a labelled dialog with focus in the name', () => {
    render(<Opener />);
    openSheet();
    const dialog = screen.getByRole('dialog', { name: 'New outpost' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(nameInput());
  });

  it('returns focus to the control that opened it, on Escape and on Cancel', () => {
    render(<Opener />);
    const opener = openSheet();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', () => {
    render(<Opener />);
    openSheet();
    const create = screen.getByRole('button', { name: 'Create outpost' });
    create.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('does not create without a name, says why, and focuses the field', () => {
    const onStart = vi.fn<Start>(() => Promise.resolve());
    render(<Opener onStart={onStart} />);
    openSheet();
    expect(screen.queryByText('Enter a name.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create outpost' }));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(nameInput());
    fireEvent.change(nameInput(), { target: { value: 'Usage by user' } });
    expect(screen.queryByText('Enter a name.')).toBeNull();
  });

  it('adds a chat with a suggested handle and will not offer a Terminal session', () => {
    render(<Opener />);
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Add a chat' }));
    const terminal = screen.getByRole<HTMLButtonElement>('menuitemradio', { name: /Shell/ });
    expect(terminal.disabled).toBe(true);
    expect(terminal.textContent).toContain('Terminal sessions cannot join an outpost');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Usage page/ }));
    const handle = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Handle for Usage page',
    });
    expect(handle.value).toBe('web');
    expect(screen.getByText('web · spark/usage')).toBeTruthy();
  });

  it('flags a duplicate handle on the chat and creates once it is fixed', async () => {
    const onStart = vi.fn<Start>(() => Promise.resolve());
    render(<Opener initial={FORM} onStart={onStart} />);
    openSheet();
    const handle = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Handle for Usage endpoint',
    });
    fireEvent.change(handle, { target: { value: '@FE' } });
    expect(handle.value).toBe('fe');
    fireEvent.click(screen.getByRole('button', { name: 'Create outpost' }));
    expect(onStart).not.toHaveBeenCalled();
    expect(screen.getAllByText('@fe is already used in this outpost.')).toHaveLength(2);
    expect(handle.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(handle, { target: { value: 'api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create outpost' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(FORM));
  });

  it('removes a chat from the list', () => {
    render(<Opener initial={FORM} />);
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Usage page' }));
    expect(screen.queryByRole('textbox', { name: 'Handle for Usage page' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Handle for Usage endpoint' })).toBeTruthy();
  });

  it('shows what the server said when saving fails and stays open', async () => {
    const onStart = vi.fn<Start>(() =>
      Promise.reject(new Error('That chat is in another outpost.')),
    );
    render(<Opener initial={FORM} onStart={onStart} />);
    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Create outpost' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That chat is in another outpost.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('edits an existing outpost and offers a held delete', () => {
    render(<Opener initial={FORM} onDelete={vi.fn(() => Promise.resolve())} />);
    openSheet();
    expect(screen.getByRole('dialog', { name: 'Edit outpost' })).toBeTruthy();
    expect(nameInput().value).toBe('Usage by user');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Hold to delete outpost/ })).toBeTruthy();
    expect(screen.getByText('Deletes this outpost and its thread. The chats stay.')).toBeTruthy();
  });

  it('only renames on a phone: no handles, no chats to add or remove, no delete', () => {
    render(<Opener initial={FORM} canManage={false} onDelete={vi.fn(() => Promise.resolve())} />);
    openSheet();
    expect(nameInput().value).toBe('Usage by user');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hold to delete outpost/ })).toBeNull();
    expect(screen.getByText(/Chats and handles are changed on your Mac/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});
