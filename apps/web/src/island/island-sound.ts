import { useEffect, useMemo, useRef } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { needsInput } from '../conversations/row-state.ts';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import type { Moment } from './island-model.ts';
import { useOnScreenChat } from './on-screen-chat.ts';

export type Chime = 'needs' | 'done' | 'failed';

const NOTES: Record<Chime, number[]> = {
  needs: [659.25, 880],
  done: [523.25, 659.25, 783.99],
  failed: [392, 293.66],
};
const NOTE_GAP = 0.11;
const PEAK = 0.07;

let audio: AudioContext | null = null;

function playChime(chime: Chime): void {
  if (typeof AudioContext === 'undefined') return;
  audio ??= new AudioContext();
  const context = audio;
  const start = context.currentTime + 0.02;
  NOTES[chime].forEach((frequency, index) => {
    const at = start + index * NOTE_GAP;
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency;
    level.gain.setValueAtTime(0.0001, at);
    level.gain.exponentialRampToValueAtTime(PEAK, at + 0.02);
    level.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    tone.connect(level).connect(context.destination);
    tone.start(at);
    tone.stop(at + 0.5);
  });
}

export interface IslandSound {
  on: boolean;
  toggle: () => void;
}

export function useIslandSound(): IslandSound | null {
  const status = useCompanionStatus();
  const companion = sparkDesktop()?.companion;
  if (!status?.supported || !companion?.setSound) return null;
  const on = status.sound === true;
  return { on, toggle: () => void companion.setSound?.(!on) };
}

export function waitingChats(chats: readonly ConversationSummary[]): string[] {
  return chats.filter((chat) => !chat.archivedAt && needsInput(chat)).map((chat) => chat.id);
}

export function needsChime(
  before: ReadonlySet<string>,
  waiting: readonly string[],
  watchedChat: string | null,
): boolean {
  return waiting.some((id) => !before.has(id) && id !== watchedChat);
}

export function momentChime(moment: Moment, watchedChat: string | null): Chime | null {
  if (moment.kind === 'done') return 'done';
  return moment.chatId === watchedChat ? null : 'failed';
}

export function useChimes(
  on: boolean,
  chats: readonly ConversationSummary[] | null,
  moment: Moment | null,
  sparkFocused: boolean,
): void {
  const onScreenChat = useOnScreenChat();
  const watchedChat = sparkFocused ? onScreenChat : null;
  const facts = useRef({ on, watchedChat });
  const seen = useRef<ReadonlySet<string> | null>(null);
  const chimedRun = useRef<string | null>(null);
  const waiting = useMemo(() => (chats ? waitingChats(chats) : null), [chats]);

  useEffect(() => {
    facts.current = { on, watchedChat };
  }, [on, watchedChat]);

  useEffect(() => {
    const before = seen.current;
    seen.current = waiting ? new Set(waiting) : null;
    if (!facts.current.on || !before || !waiting) return;
    if (needsChime(before, waiting, facts.current.watchedChat)) playChime('needs');
  }, [waiting]);

  useEffect(() => {
    if (!moment || chimedRun.current === moment.runId) return;
    chimedRun.current = moment.runId;
    const chime = facts.current.on ? momentChime(moment, facts.current.watchedChat) : null;
    if (chime) playChime(chime);
  }, [moment]);
}
