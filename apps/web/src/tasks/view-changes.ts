import { createContext, useContext } from 'react';
import type { ChangeEntry } from '@spark-outpost/contracts';

export type ViewChanges = (taskId?: string, file?: ChangeEntry) => void;

export const ViewChangesContext = createContext<ViewChanges | null>(null);

export function useViewChanges(): ViewChanges | null {
  return useContext(ViewChangesContext);
}
