import { useEffect, useRef } from 'react';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';
import type { Moment } from './island-model.ts';

export type Chime = 'needs' | 'done' | 'failed';

type Tune = Chime | 'meeting';

const NOTES: Record<Tune, number[]> = {
  meeting: [783.99, 1046.5, 783.99, 1174.66],
  needs: [659.25, 880],
  done: [523.25, 659.25, 783.99],
  failed: [392, 293.66],
};
const NOTE_GAP = 0.11;
const PEAK = 0.07;

let audio: AudioContext | null = null;

function playChime(chime: Tune): void {
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

export function playMeetingChime(): void {
  playChime('meeting');
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

export interface Alert {
  key: string;
  chatId: string;
}

export function alertChime(
  before: ReadonlySet<string>,
  alerts: readonly Alert[],
  viewed: ReadonlySet<string>,
): boolean {
  return alerts.some((alert) => !before.has(alert.key) && !viewed.has(alert.chatId));
}

export interface ChimeHold {
  held: boolean;
  onHeld: (chime: Chime) => void;
}

const NOT_HELD: ChimeHold = { held: false, onHeld: () => undefined };

export function routeChime(held: boolean, on: boolean): 'hold' | 'play' | 'skip' {
  if (held) return 'hold';
  return on ? 'play' : 'skip';
}

function sound(chime: Chime, facts: { on: boolean; hold: ChimeHold }): void {
  const route = routeChime(facts.hold.held, facts.on);
  if (route === 'hold') facts.hold.onHeld(chime);
  if (route === 'play') playChime(chime);
}

export function useChimes(
  on: boolean,
  alerts: readonly Alert[] | null,
  moment: Moment | null,
  viewed: ReadonlySet<string>,
  hold: ChimeHold = NOT_HELD,
): void {
  const facts = useRef({ on, viewed, hold });
  const seen = useRef<ReadonlySet<string> | null>(null);
  const heldRun = useRef<string | null>(null);
  const keys = alerts ? alerts.map((alert) => alert.key).join(' ') : null;
  const latest = useRef(alerts);

  useEffect(() => {
    facts.current = { on, viewed, hold };
    latest.current = alerts;
  });

  useEffect(() => {
    const current = latest.current;
    const before = seen.current;
    seen.current = current ? new Set(current.map((alert) => alert.key)) : null;
    if (!before || !current) return;
    if (alertChime(before, current, facts.current.viewed)) sound('needs', facts.current);
  }, [keys]);

  useEffect(() => {
    if (!moment || heldRun.current === moment.runId) return;
    heldRun.current = moment.runId;
    const { hold: current, viewed: open } = facts.current;
    if (current.held && !open.has(moment.chatId)) current.onHeld(moment.kind);
  }, [moment]);
}
