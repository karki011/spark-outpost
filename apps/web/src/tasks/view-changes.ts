import { createContext, useContext } from 'react';

export type ViewChanges = (taskId?: string) => void;

export const ViewChangesContext = createContext<ViewChanges | null>(null);

export function useViewChanges(): ViewChanges | null {
  return useContext(ViewChangesContext);
}
