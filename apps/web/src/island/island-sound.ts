import { useEffect, useRef } from 'react';
import { sparkDesktop } from '../desktop/desktop-bridge.ts';
import { useCompanionStatus } from '../desktop/use-companion-status.ts';

type Chime = 'needs' | 'done';

const NOTES: Record<Chime, number[]> = {
  needs: [659.25, 880],
  done: [523.25, 659.25, 783.99],
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

export function useChimes(on: boolean, waiting: number | null, finishedRun: string | null): void {
  const enabled = useRef(on);
  const seen = useRef(waiting);

  useEffect(() => {
    enabled.current = on;
  }, [on]);

  useEffect(() => {
    const before = seen.current;
    seen.current = waiting;
    if (enabled.current && before !== null && waiting !== null && waiting > before) {
      playChime('needs');
    }
  }, [waiting]);

  useEffect(() => {
    if (enabled.current && finishedRun) playChime('done');
  }, [finishedRun]);
}
