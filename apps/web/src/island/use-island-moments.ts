import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { memberNeedsYou } from '../chat/outpost/member-moment.ts';
import type { Voice } from '../spark/voice.ts';
import { dayKey, greetingDue, greetingLine } from './crew-voice.ts';
import {
  newMoments,
  nextStreak,
  runStatuses,
  type Moment,
  type RunStatuses,
} from './island-model.ts';

const MEMORY_KEY = 'spark-outpost.island';
const GREETING_MS = 4_000;
const SEEN_EVERY_MS = 60_000;

let lastNoted = 0;

interface Memory {
  streak: number;
  lastSeen: number | null;
  greetedDay: string | null;
}

function readMemory(): Memory {
  try {
    const value = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}') as Partial<Memory>;
    return {
      streak: typeof value.streak === 'number' ? value.streak : 0,
      lastSeen: typeof value.lastSeen === 'number' ? value.lastSeen : null,
      greetedDay: typeof value.greetedDay === 'string' ? value.greetedDay : null,
    };
  } catch {
    return { streak: 0, lastSeen: null, greetedDay: null };
  }
}

function writeMemory(update: Partial<Memory>): void {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...readMemory(), ...update }));
  } catch {
    return;
  }
}

export function useMoments(chats: readonly ConversationSummary[], loaded: boolean) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [streak, setStreak] = useState(() => readMemory().streak);
  const previous = useRef<RunStatuses | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const before = previous.current;
    previous.current = runStatuses(chats);
    if (!before) return;
    const fresh = newMoments(before, chats);
    if (fresh.length === 0) return;
    setMoments((list) => [...list, ...fresh]);
    setStreak((value) => {
      const next = fresh.reduce(nextStreak, value);
      writeMemory({ streak: next });
      return next;
    });
  }, [chats, loaded]);

  const dismiss = useCallback(() => setMoments((list) => list.slice(1)), []);
  const moment = moments[0] ?? null;
  const memberLine = moment ? memberNeedsYou(moment, chats) : null;
  return { moment, memberLine, streak, dismiss };
}

export function momentLine(
  kind: 'done' | 'failed',
  title: string,
  memberLine: string | null,
): string {
  if (memberLine) return memberLine;
  return `${title} ${kind === 'done' ? 'is done' : 'couldn’t finish'}.`;
}

export function useGreeting(voice: Voice, ready: boolean): string | null {
  const [start] = useState(() => new Date());
  const [due] = useState(() => {
    const memory = readMemory();
    return greetingDue(memory.lastSeen, memory.greetedDay, start);
  });
  const [shown, setShown] = useState(true);
  useEffect(() => {
    writeMemory({ lastSeen: start.getTime(), greetedDay: dayKey(start) });
  }, [start]);
  useEffect(() => {
    if (!ready || !due) return;
    const timer = setTimeout(() => setShown(false), GREETING_MS);
    return () => clearTimeout(timer);
  }, [ready, due]);
  return ready && due && shown ? greetingLine(voice, due, start) : null;
}

export function noteSeen(): void {
  const now = Date.now();
  if (now - lastNoted < SEEN_EVERY_MS) return;
  lastNoted = now;
  writeMemory({ lastSeen: now });
}
