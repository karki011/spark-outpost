// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VoiceEvent } from '@spark-outpost/contracts';
import { useDictationDraft } from './use-dictation-draft.ts';
import { useSendAfterDictation } from './use-send-after-dictation.ts';

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

function composer() {
  const sent: { choice: string; text: string; attachments: string[] }[] = [];
  const hook = renderHook(() => {
    const [text, setText] = useState('Typed');
    const [attachments, setAttachments] = useState<string[]>([]);
    const voice = useDictationDraft(text, setText, 'chat');
    const submit = useSendAfterDictation(voice, text, async (choice: string, outgoing) => {
      sent.push({ choice, text: outgoing, attachments });
    });
    return { voice, submit, setAttachments };
  });
  return { hook, sent };
}

it('sends at once when not dictating', () => {
  const { hook, sent } = composer();
  act(() => hook.result.current.submit('queue'));
  expect(sent).toEqual([{ choice: 'queue', text: 'Typed', attachments: [] }]);
});

it('sends the final words with what the composer holds when they arrive, not when Enter was pressed', async () => {
  const { hook, sent } = composer();
  await act(async () => hook.result.current.voice.dictation.toggle());
  act(() => hook.result.current.submit('now'));
  expect(sent).toEqual([]);
  act(() => hook.result.current.setAttachments(['notes.md']));
  act(() => speech.event?.({ kind: 'final', id: 'listen', text: 'and more.', reason: 'stopped' }));
  expect(sent).toEqual([{ choice: 'now', text: 'Typed and more.', attachments: ['notes.md'] }]);
});
