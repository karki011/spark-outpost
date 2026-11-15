import { createContext, useContext } from 'react';

const SwitchWords = createContext(false);

export const SwitchWordsProvider = SwitchWords.Provider;

export function useSwitchWords(): boolean {
  return useContext(SwitchWords);
}
