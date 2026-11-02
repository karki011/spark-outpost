import { joinDictation, useDictation } from './use-dictation.ts';

export function useDictationDraft(
  text: string,
  onText: (text: string) => void,
  scope: string,
  onSpoken?: () => void,
) {
  const dictation = useDictation((heard) => {
    onSpoken?.();
    onText(joinDictation(text, heard));
  }, scope);
  const { state } = dictation;
  const partial = state.phase === 'listening' || state.phase === 'working' ? state.partial : '';
  return {
    dictation,
    value: joinDictation(text, partial),
    change: (value: string) => {
      if (partial.trim()) onSpoken?.();
      if (dictation.active) dictation.cancel();
      onText(value);
    },
  };
}
