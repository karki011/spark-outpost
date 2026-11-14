// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { setFileDraft, settleFileDraft, useFileDraft } from './file-drafts.ts';

it('clears the draft when the saved text is what the editor still shows', () => {
  const { result } = renderHook(() => useFileDraft('pip', 'SPARK.md'));
  act(() => setFileDraft('pip', 'SPARK.md', { text: 'one', baseHash: 'h0' }));

  act(() => settleFileDraft('pip', 'SPARK.md', { text: 'one', hash: 'h1' }));

  expect(result.current).toBeNull();
});

it('keeps text typed while the save was going, on top of the saved version', () => {
  const { result } = renderHook(() => useFileDraft('pip', 'notes.md'));
  act(() => setFileDraft('pip', 'notes.md', { text: 'one two', baseHash: 'h0' }));

  act(() => settleFileDraft('pip', 'notes.md', { text: 'one', hash: 'h1' }));

  expect(result.current).toEqual({ text: 'one two', baseHash: 'h1' });
});
