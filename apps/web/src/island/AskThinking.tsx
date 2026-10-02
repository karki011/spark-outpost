import { useEffect, useState } from 'react';
import { BlobScout } from '../brand/BlobScout.tsx';
import type { Voice } from '../spark/voice.ts';

export const THINKING_STEP_MS = 2_400;

export function thinkingLines(voice: Voice, step: string | null): string[] {
  const named = voice.personality !== 'facts' && voice.name;
  return [
    'Spark is looking…',
    step ? `${step.charAt(0).toUpperCase()}${step.slice(1)}…` : 'Checking your chats…',
    named ? `Almost there, ${voice.name}…` : 'Almost there…',
  ];
}

export function AskThinking({ voice, step }: { voice: Voice; step: string | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), THINKING_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  const lines = thinkingLines(voice, step);
  const line = lines[Math.min(tick, lines.length - 1)]!;
  return (
    <div className="isl-ask-a isl-thinking" role="status">
      <span className="isl-think-scene" aria-hidden="true">
        <BlobScout size={28} mood="working" />
        <svg className="isl-glass" viewBox="0 0 16 16" width="13" height="13">
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l4.5 4.5" />
        </svg>
      </span>
      <span key={line} className="isl-think-line">
        {line}
      </span>
    </div>
  );
}
