// @vitest-environment jsdom
import { useLayoutEffect, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VoiceEvent, VoiceListenResult } from '@spark-outpost/contracts';
import { useDictationDraft } from './use-dictation-draft.ts';

const speech = vi.hoisted(() => ({
  listen: vi.fn(),
  cancel: vi.fn(),
  stop: vi.fn(),
  event: null as ((event: VoiceEvent) => void) | null,
}));
vi.mock('./speech-bridge.ts', () => ({
  desktopSpeech: () => speech,
  useSpeechStatus: () => ({ settings: { enabled: true } }),
  useSpeechEvents: (callback: (event: VoiceEvent) => void) => {
    speech.event = callback;
  },
}));
beforeEach(() => {
  speech.listen.mockReset().mockResolvedValue({ ok: true, id: 'listen' });
  speech.cancel.mockReset().mockResolvedValue(undefined);
  speech.stop.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

function draft() {
  return renderHook(
    ({ scope }) => {
      const [text, setText] = useState('Typed draft');
      return { ...useDictationDraft(text, setText, scope), committed: text };
    },
    { initialProps: { scope: 'first' } },
  );
}
function emit(event: VoiceEvent) {
  act(() => speech.event?.(event));
}
const partial = (text: string): VoiceEvent => ({ kind: 'partial', id: 'listen', text });
const final = (text: string): VoiceEvent => ({
  kind: 'final',
  id: 'listen',
  text,
  reason: 'stopped',
});

it('previews replacing partials without persisting them, then commits a final exactly once', async () => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('hello'));
  expect(hook.result.current.value).toBe('Typed draft hello');
  expect(hook.result.current.committed).toBe('Typed draft');
  emit(partial('hello world'));
  expect(hook.result.current.value).toBe('Typed draft hello world');
  act(() => hook.result.current.dictation.toggle());
  emit(partial('hello world!'));
  expect(hook.result.current.dictation.state.phase).toBe('working');
  emit(final('Hello world.'));
  emit(final('Hello world.'));
  expect(hook.result.current.committed).toBe('Typed draft Hello world.');
  expect(hook.result.current.dictation.active).toBe(false);
});

it.each(['cancelled', 'error'] as const)('restores the committed draft after %s', async (kind) => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('temporary'));
  emit(kind === 'error' ? { kind, id: 'listen', error: 'failed' } : { kind, id: 'listen' });
  expect(hook.result.current.value).toBe('Typed draft');
  emit(final('late'));
  expect(hook.result.current.value).toBe('Typed draft');
});

it('Escape cancels immediately, restoring the draft before the helper replies', async () => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('temporary'));
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(speech.cancel).toHaveBeenCalledWith('listen');
  expect(hook.result.current.value).toBe('Typed draft');
  emit(final('late'));
  expect(hook.result.current.value).toBe('Typed draft');
});

it('keeps a user edit of live text and stops dictation so later words cannot overwrite it', async () => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('hello'));
  act(() => hook.result.current.change('Edited draft hello!'));
  expect(speech.cancel).toHaveBeenCalledWith('listen');
  emit(final('unexpected'));
  expect(hook.result.current.committed).toBe('Edited draft hello!');
});

it('drops partials and final events on a conversation switch', async () => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('temporary'));
  hook.rerender({ scope: 'second' });
  expect(hook.result.current.value).toBe('Typed draft');
  expect(speech.cancel).toHaveBeenCalledWith('listen');
  emit(final('late'));
  expect(hook.result.current.committed).toBe('Typed draft');
});

it.each(['switch', 'unmount', 'escape'] as const)(
  'cancels a listen whose start finishes after %s',
  async (action) => {
    let resolve!: (result: VoiceListenResult) => void;
    speech.listen.mockReturnValue(
      new Promise<VoiceListenResult>((done) => {
        resolve = done;
      }),
    );
    const hook = draft();
    act(() => hook.result.current.dictation.toggle());
    if (action === 'switch') hook.rerender({ scope: 'second' });
    else if (action === 'unmount') hook.unmount();
    else act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await act(async () => resolve({ ok: true, id: 'late-start' }));
    expect(speech.cancel).toHaveBeenCalledWith('late-start');
  },
);

it('marks only final speech or an edited speech preview as spoken, not keyboard input', async () => {
  const spoken = vi.fn();
  const hook = renderHook(() => {
    const [text, setText] = useState('');
    return useDictationDraft(text, setText, 'ask', spoken);
  });
  act(() => hook.result.current.change('Typed'));
  expect(spoken).not.toHaveBeenCalled();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('hello'));
  act(() => hook.result.current.change('Typed hello!'));
  expect(spoken).toHaveBeenCalledTimes(1);
  await act(async () => hook.result.current.dictation.toggle());
  emit(final('more speech'));
  expect(spoken).toHaveBeenCalledTimes(2);
});

it('recovers from a rejected stop without retaining provisional text', async () => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('temporary'));
  speech.stop.mockRejectedValueOnce(new Error('helper unavailable'));
  await act(async () => hook.result.current.dictation.toggle());
  expect(hook.result.current.dictation.active).toBe(false);
  expect(hook.result.current.dictation.problem).toBe('Voice stopped. Try again.');
  expect(hook.result.current.value).toBe('Typed draft');
  emit(final('late'));
  expect(hook.result.current.value).toBe('Typed draft');
});

it('rejects a final delivered during the new scope commit before passive effects', async () => {
  const committed = vi.fn();
  const hook = renderHook(
    ({ scope }) => {
      const voice = useDictationDraft(scope, committed, scope);
      useLayoutEffect(() => {
        if (scope === 'second') speech.event?.(final('late first chat text'));
      }, [scope]);
      return voice;
    },
    { initialProps: { scope: 'first' } },
  );
  await act(async () => hook.result.current.dictation.toggle());
  emit(partial('temporary'));
  hook.rerender({ scope: 'second' });
  expect(committed).not.toHaveBeenCalled();
  expect(speech.cancel).toHaveBeenCalledWith('listen');
  expect(hook.result.current.value).toBe('second');
  expect(hook.result.current.dictation.active).toBe(false);
});

it('replaces revised tentative words on every partial and commits only the final', async () => {
  const hook = draft();
  await act(async () => hook.result.current.dictation.toggle());
  for (const words of [
    'I scream',
    'ice cream for',
    'ice cream for every',
    'ice cream for everyone',
  ])
    emit(partial(words));
  expect(hook.result.current.value).toBe('Typed draft ice cream for everyone');
  expect(hook.result.current.committed).toBe('Typed draft');
  act(() => hook.result.current.dictation.toggle());
  emit(final('Ice cream for everyone.'));
  expect(hook.result.current.committed).toBe('Typed draft Ice cream for everyone.');
});
