// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_CHAT, FE_CHAT } from '../test-fixtures.ts';
import {
  API_PROJECT,
  countingIds,
  createData,
  draftOf,
  existing,
  file,
  fresh,
} from './create-fixtures.ts';
import { StepReview } from './StepReview.tsx';

afterEach(cleanup);

describe('StepReview', () => {
  it('lists each chat with its handle, first message and file count', () => {
    const ids = countingIds();
    const api = {
      ...fresh(ids, API_PROJECT, 'api'),
      text: 'Add an optional userId filter.',
      files: [file(1), file(2)],
    };
    const docs = { ...existing(ids, API_CHAT, 'docs'), text: 'Document it.', files: [file(3)] };
    render(
      <StepReview
        draft={draftOf([existing(ids, FE_CHAT, 'fe'), api, docs])}
        data={createData()}
        onEditName={vi.fn()}
        onEditChats={vi.fn()}
      />,
    );
    const rows = screen.getAllByRole('listitem').slice(0, 3);

    expect(rows.map((row) => within(row).getByText(/^@/).textContent)).toEqual([
      '@fe',
      '@api',
      '@docs',
    ]);
    expect(within(rows[0]!).queryByText(/file/)).toBeNull();
    expect(within(rows[1]!).getByText('Add an optional userId filter.')).toBeTruthy();
    expect(within(rows[1]!).getByText('2 files')).toBeTruthy();
    expect(within(rows[2]!).getByText('1 file')).toBeTruthy();
    expect(screen.getByText('Creates 1 new chat')).toBeTruthy();
    expect(screen.getByText('Sends 2 first requests')).toBeTruthy();
    expect(screen.getByText('Each chat works under its own mode.')).toBeTruthy();
  });
});
