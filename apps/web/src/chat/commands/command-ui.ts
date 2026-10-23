import { createContext, use, useState } from 'react';

export interface CommandUi {
  open: boolean | null;
  tall: boolean;
  focused: boolean;
}

export type CommandUiStore = Map<string, CommandUi>;

const FRESH: CommandUi = { open: null, tall: false, focused: false };

export const CommandUiContext = createContext<CommandUiStore | null>(null);

export function shownBefore(store: CommandUiStore | null, commandId: string): boolean {
  const ui = store?.get(commandId);
  return ui?.open === true || ui?.focused === true;
}

export function useCommandUi(commandId: string) {
  const store = use(CommandUiContext);
  const [ui, setUi] = useState(() => store?.get(commandId) ?? FRESH);
  const update = (change: Partial<CommandUi>) =>
    setUi((current) => {
      const next = { ...current, ...change };
      store?.set(commandId, next);
      return next;
    });
  return [ui, update] as const;
}
