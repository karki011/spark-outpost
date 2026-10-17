// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEntry, FileRevertCheck } from '@spark-outpost/contracts';
import { DiffPane } from './DiffPane.tsx';
import { revertFileText } from './RevertFile.tsx';

const TASK = '00000000-0000-4000-8000-000000000004';
const RUN = '00000000-0000-4000-8000-000000000001';

const entry: ChangeEntry = {
  runId: RUN,
  path: 'src/app.ts',
  change: 'modified',
  added: 1,
  removed: 1,
  shown: 'binary',
  bytes: 10,
};

const ready: FileRevertCheck = {
  path: 'src/app.ts',
  change: 'modified',
  revertible: true,
  reason: null,
  protectedKind: null,
  committed: false,
  pushed: false,
};

function answer(check: FileRevertCheck) {
  const posted = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/changes/revert-file')) return new Response('{}', { status: 404 });
      if (init?.method === 'POST') {
        posted(JSON.parse(String(init.body)));
        return Response.json({
          restored: [{ path: entry.path, change: 'modified' }],
          revertedAt: 'x',
        });
      }
      return Response.json(check);
    }),
  );
  return posted;
}

function show(onReverted = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DiffPane
        taskId={TASK}
        version="v1"
        entry={entry}
        mode="unified"
        wrap={false}
        onMode={() => undefined}
        onWrap={() => undefined}
        reverted={null}
        onReverted={onReverted}
      />
    </QueryClientProvider>,
  );
  return onReverted;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Revert file in the Changes drawer', () => {
  it('asks first, focuses the confirm button and reverts that one file', async () => {
    const posted = answer(ready);
    const onReverted = show();

    fireEvent.click(screen.getByRole('button', { name: 'Revert file' }));
    const group = await screen.findByRole('group', { name: 'Revert src/app.ts' });
    const confirm = await within(group).findByRole('button', { name: 'Revert file' });
    expect(group.textContent).toContain('Restores it to how it was before this run.');
    await vi.waitFor(() => expect(document.activeElement).toBe(confirm));

    fireEvent.click(confirm);

    await vi.waitFor(() => expect(onReverted).toHaveBeenCalledWith('src/app.ts'));
    expect(posted).toHaveBeenCalledWith({ runId: RUN, path: 'src/app.ts', version: 'v1' });
  });

  it('closes on Escape and gives focus back to the button', async () => {
    answer(ready);
    show();
    const opener = screen.getByRole('button', { name: 'Revert file' });

    fireEvent.click(opener);
    const group = await screen.findByRole('group', { name: 'Revert src/app.ts' });
    fireEvent.keyDown(group, { key: 'Escape' });

    await vi.waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Revert src/app.ts' })).toBeNull(),
    );
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows why a file cannot be reverted and offers only Close', async () => {
    answer({ ...ready, revertible: false, reason: 'This file changed after this run.' });
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Revert file' }));

    expect(await screen.findByText('This file changed after this run.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep file' })).toBeNull();
  });
});

describe('the confirm text', () => {
  it('names what happens to a created, deleted, renamed or committed file', () => {
    expect(revertFileText({ ...ready, change: 'added' })).toContain('Deletes it');
    expect(revertFileText({ ...ready, change: 'deleted' })).toContain('Brings it back');
    expect(revertFileText({ ...ready, oldPath: 'src/old.ts' })).toContain(
      'Moves it back to src/old.ts',
    );
    expect(revertFileText({ ...ready, committed: true, pushed: true })).toContain(
      'committed and pushed: only your working copy changes',
    );
    expect(revertFileText({ ...ready, protectedKind: 'secret' })).toContain('a secret file');
  });
});
