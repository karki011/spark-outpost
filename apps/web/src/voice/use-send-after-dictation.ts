import { useLayoutEffect, useRef } from 'react';
import type { useDictationDraft } from './use-dictation-draft.ts';

type Send<Choice> = (choice: Choice, text: string) => Promise<void>;

export function useSendAfterDictation<Choice>(
  voice: ReturnType<typeof useDictationDraft>,
  draft: string,
  send: Send<Choice>,
) {
  const latest = useRef(send);
  useLayoutEffect(() => {
    latest.current = send;
  });
  return (choice: Choice) => {
    if (voice.dictation.active) voice.finish((spoken) => void latest.current(choice, spoken));
    else void send(choice, draft);
  };
}
