import { useEffect, useRef, useState } from 'react';
import type {
  VoiceEvent,
  VoiceListenResult,
  VoicePurpose,
  VoiceSettings,
  VoiceStatus,
} from '@spark-outpost/contracts';

type Unsubscribe = () => void;

export type PrivacyPage = 'microphone' | 'input-monitoring' | 'keyboard';

export interface DesktopSpeech {
  status(): Promise<VoiceStatus | null>;
  turnOn(): Promise<VoiceStatus | null>;
  turnOff(): Promise<VoiceStatus | null>;
  update(
    patch: Partial<Pick<VoiceSettings, 'speakAnswers' | 'shortcutMode' | 'hold'>>,
  ): Promise<VoiceStatus | null>;
  listen(purpose: VoicePurpose, hint: string, file?: string): Promise<VoiceListenResult>;
  stop(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  speak(text: string): Promise<string | null>;
  hush(): Promise<void>;
  openSettings(page: PrivacyPage): Promise<void>;
  onEvent(callback: (event: VoiceEvent) => void): Unsubscribe;
  onChange(callback: (status: VoiceStatus) => void): Unsubscribe;
}

export function desktopSpeech(): DesktopSpeech | null {
  if (typeof window === 'undefined') return null;
  const desktop = (window as { sparkDesktop?: { speech?: DesktopSpeech } }).sparkDesktop;
  return desktop?.speech ?? null;
}

export function useSpeechStatus(): VoiceStatus | null {
  return useSpeechStatusState()[0];
}

export function useSpeechStatusState() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    const speech = desktopSpeech();
    if (!speech) return;
    let live = true;
    void speech.status().then((next) => {
      if (live) setStatus(next);
    });
    const off = speech.onChange((next) => setStatus(next));
    return () => {
      live = false;
      off();
    };
  }, []);
  return [status, setStatus] as const;
}

export function useSpeechEvents(callback: (event: VoiceEvent) => void): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => {
    const speech = desktopSpeech();
    if (!speech) return;
    return speech.onEvent((event) => latest.current(event));
  }, []);
}
