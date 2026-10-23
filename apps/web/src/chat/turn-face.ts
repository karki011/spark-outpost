import { createContext, use, type ReactNode } from 'react';

export type TurnState = 'working' | 'waiting' | 'done' | 'failed' | 'stopped';

export interface TurnFace {
  name: string;
  face: (state: TurnState) => ReactNode;
}

export const TurnFaceContext = createContext<TurnFace | null>(null);

export function useTurnFace(): TurnFace | null {
  return use(TurnFaceContext);
}
