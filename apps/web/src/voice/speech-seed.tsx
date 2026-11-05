import { createContext, useContext, useEffect, useRef } from 'react';
import type { InstantAnswer } from './answers.ts';
import type { TicketRef } from './commands.ts';

export type SpeechSeed =
  | { kind: 'quick'; id: number; text: string; projectId: string | null; ticket: TicketRef | null }
  | { kind: 'ask'; id: number; question: string; answer: InstantAnswer | null }
  | { kind: 'reply'; id: number; chatId: string; text: string };

export interface SpeechSeeds {
  seed: SpeechSeed | null;
  confirmed: { id: number; count: number };
  speak(text: string): void;
}

const NONE: SpeechSeeds = {
  seed: null,
  confirmed: { id: 0, count: 0 },
  speak: () => undefined,
};

export const SpeechSeedContext = createContext<SpeechSeeds>(NONE);

export function useSpeechSeeds(): SpeechSeeds {
  return useContext(SpeechSeedContext);
}

export function useSeed<Kind extends SpeechSeed['kind']>(
  kind: Kind,
  apply: (seed: Extract<SpeechSeed, { kind: Kind }>) => void,
  confirm: () => void,
): Extract<SpeechSeed, { kind: Kind }> | null {
  const { seed, confirmed } = useSpeechSeeds();
  const mine = seed?.kind === kind ? (seed as Extract<SpeechSeed, { kind: Kind }>) : null;
  const handlers = useRef({ apply, confirm });
  useEffect(() => {
    handlers.current = { apply, confirm };
  });
  const applied = useRef(0);
  useEffect(() => {
    if (!mine || applied.current === mine.id) return;
    applied.current = mine.id;
    handlers.current.apply(mine);
  }, [mine]);
  const seen = useRef(confirmed.count);
  useEffect(() => {
    if (confirmed.count === seen.current) return;
    seen.current = confirmed.count;
    if (mine && confirmed.id === mine.id) handlers.current.confirm();
  }, [confirmed, mine]);
  return mine;
}
