import { createContext, type ReactNode } from 'react';

export const RailContext = createContext<ReactNode>(null);

export const RailTaskContext = createContext<string | null>(null);
