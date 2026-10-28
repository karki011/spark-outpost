import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

export function useDictation(onText: (text: string) => void, scope: string) {
  const speech = desktopSpeech();
  const status = useSpeechStatus();
  const [state, setState] = useState<DictationState>({ phase: 'idle' });
  const [problem, setProblem] = useState<string | null>(null);
  const current = useRef<{ id: string; scope: string } | null>(null);
  const generation = useRef(0);
  const [stateScope, setStateScope] = useState(scope);
  if (stateScope !== scope) {
    setStateScope(scope);
    setState({ phase: 'idle' });
    setProblem(null);
  }

  const cancel = () => {
    generation.current += 1;
    const id = current.current?.id;
    current.current = null;
    setState({ phase: 'idle' });
    if (id && speech) void speech.cancel(id).catch(() => undefined);
  };

  useLayoutEffect(() => {
    return () => {
      generation.current += 1;
      const id = current.current?.id;
      current.current = null;
      if (id && speech) void speech.cancel(id).catch(() => undefined);
    };
  }, [scope, speech]);

  useSpeechEvents((event) => {
    if (!('id' in event) || event.id !== current.current?.id || current.current.scope !== scope)
      return;
    if (event.kind === 'partial') {
      setState((before) => ({
        phase: before.phase === 'working' ? 'working' : 'listening',
        id: event.id,
        partial: event.text,
      }));
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
    const pending = ++generation.current;
    let answer;
    try {
      answer = await speech.listen('dictation', '');
    } catch {
      if (pending === generation.current) {
        setState({ phase: 'idle' });
        setProblem(DICTATION_PROBLEMS.failed!);
      }
      return;
    }
    if (pending !== generation.current) {
      if (answer.ok) void speech.cancel(answer.id).catch(() => undefined);
      return;
    }
    if (!answer.ok) {
      setState({ phase: 'idle' });
      setProblem(DICTATION_PROBLEMS[answer.error] ?? DICTATION_PROBLEMS.failed!);
      return;
    }
    current.current = { id: answer.id, scope };
    setState({ phase: 'listening', id: answer.id, partial: '' });
  };

  const stop = () => {
    if (state.phase !== 'listening' || !speech) return;
    const id = state.id;
    void speech.stop(id).catch(() => {
      if (current.current?.id !== id || current.current.scope !== scope) return;
      cancel();
      setProblem(DICTATION_PROBLEMS.failed!);
    });
    setState({ ...state, phase: 'working' });
  };

  const active = state.phase !== 'idle';
  useEffect(() => {
    if (!active || !speech) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return {
    available: speech !== null && status?.settings.enabled === true,
    state,
    problem,
    active,
    cancel,
    toggle: () =>
      state.phase === 'idle' ? void start() : state.phase === 'starting' ? cancel() : stop(),
  };
}
