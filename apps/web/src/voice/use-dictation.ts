import { useEffect, useRef, useState } from 'react';
import type { VoiceErrorCode } from '@spark-outpost/contracts';
import { desktopSpeech, useSpeechEvents, useSpeechStatus } from './speech-bridge.ts';

export type DictationState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'listening'; id: string; partial: string }
  | { phase: 'working'; id: string; partial: string };

export const DICTATION_PROBLEMS: Partial<Record<VoiceErrorCode | 'missed', string>> = {
  missed: 'Didn’t catch that.',
  mic_denied:
    'Spark can’t use the microphone. Allow it in System Settings → Privacy & Security → Microphone.',
  model_missing: 'Voice is still getting its speech model. Try again in a moment.',
  busy: 'Spark is already listening.',
  no_input_device: 'No microphone is connected.',
  failed: 'Voice stopped. Try again.',
};

export function joinDictation(current: string, heard: string): string {
  const text = heard.trim();
  if (!text) return current;
  if (!current.trim()) return text;
  return /\s$/.test(current) ? `${current}${text}` : `${current} ${text}`;
}

export function useDictation(onText: (text: string) => void) {
  const speech = desktopSpeech();
  const status = useSpeechStatus();
  const [state, setState] = useState<DictationState>({ phase: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const current = useRef<string | null>(null);

  useSpeechEvents((event) => {
    if (!('id' in event) || event.id !== current.current) return;
    if (event.kind === 'partial') {
      setState({ phase: 'listening', id: event.id, partial: event.text });
    } else if (event.kind === 'final') {
      current.current = null;
      setState({ phase: 'idle' });
      if (event.text.trim()) onText(event.text.trim());
      else setProblem(DICTATION_PROBLEMS.missed!);
    } else if (event.kind === 'cancelled') {
      current.current = null;
      setState({ phase: 'idle' });
    } else if (event.kind === 'error') {
      current.current = null;
      setState({ phase: 'idle' });
      setProblem(DICTATION_PROBLEMS[event.error] ?? DICTATION_PROBLEMS.failed!);
    }
  });

  const start = async () => {
    if (!speech) return;
    setProblem(null);
    setState({ phase: 'starting' });
    const answer = await speech.listen('dictation', '');
    if (!answer.ok) {
      setState({ phase: 'idle' });
      setProblem(DICTATION_PROBLEMS[answer.error] ?? DICTATION_PROBLEMS.failed!);
      return;
    }
    current.current = answer.id;
    setState({ phase: 'listening', id: answer.id, partial: '' });
  };

  const stop = () => {
    if (state.phase !== 'listening' || !speech) return;
    void speech.stop(state.id);
    setState({ ...state, phase: 'working' });
  };

  const active = state.phase !== 'idle';
  useEffect(() => {
    if (!active || !speech) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !current.current) return;
      event.preventDefault();
      event.stopPropagation();
      void speech.cancel(current.current);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, speech]);

  return {
    available: speech !== null && status?.settings.enabled === true,
    state,
    problem,
    active,
    toggle: () => (state.phase === 'idle' ? void start() : stop()),
  };
}
