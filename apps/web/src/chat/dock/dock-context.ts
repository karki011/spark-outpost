import { createContext } from 'react';
import type { DockEntry } from './dock-model.ts';

export interface DockApi {
  slots: ReadonlyMap<string, HTMLElement>;
  register(entry: DockEntry): void;
  unregister(id: string): void;
  jump(id: string): void;
}

export const DockContext = createContext<DockApi | null>(null);
