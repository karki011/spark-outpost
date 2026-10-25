// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { restoreFailedDraft, useChatDraft } from './use-chat-draft.ts';

afterEach(cleanup);

it('restores a failed send after newer typing without replacing or duplicating either message', () => {
  const hook = renderHook(() => useChatDraft('failed-send'));
  act(() => hook.result.current[1]('New typing'));
  act(() => hook.result.current[1]((current) => restoreFailedDraft(current, 'Failed message')));
  expect(hook.result.current[0]).toBe('New typing\n\nFailed message');
  act(() => hook.result.current[1]((current) => restoreFailedDraft(current, 'Failed message')));
  expect(hook.result.current[0]).toBe('New typing\n\nFailed message');
});

it('preserves per-chat drafts through navigation and unmount and clears sent text', () => {
  const hook = renderHook(({ id }) => useChatDraft(id), { initialProps: { id: 'draft-a' } });
  act(() => hook.result.current[1]('First'));
  const restoreOrigin = hook.result.current[1];
  hook.rerender({ id: 'draft-b' });
  act(() => hook.result.current[1]('Second'));
  act(() => restoreOrigin((text) => `${text} restored`));
  expect(hook.result.current[0]).toBe('Second');
  hook.rerender({ id: 'draft-a' });
  expect(hook.result.current[0]).toBe('First restored');
  hook.unmount();
  const again = renderHook(() => useChatDraft('draft-a'));
  expect(again.result.current[0]).toBe('First restored');
  const second = renderHook(() => useChatDraft('draft-a'));
  act(() => restoreOrigin((text) => `${text} late`));
  expect(again.result.current[0]).toBe('First restored late');
  expect(second.result.current[0]).toBe('First restored late');
  act(() => again.result.current[1](''));
  again.unmount();
  expect(renderHook(() => useChatDraft('draft-a')).result.current[0]).toBe('');
});
