import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reasoningTextSchema } from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

interface ThoughtToggleProps {
  open: boolean;
  controls: string;
  onToggle(): void;
  children: ReactNode;
}

export function ThoughtToggle({ open, controls, onToggle, children }: ThoughtToggleProps) {
  return (
    <button
      type="button"
      className="step-thought-toggle"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <span>{children}</span>
      <svg className="thought-chev" width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

interface StepThoughtProps {
  id: string;
  runId: string;
  reasoningId: string;
  live: string | undefined;
  streaming: boolean;
}

export function StepThought({ id, runId, reasoningId, live, streaming }: StepThoughtProps) {
  const saved = useQuery({
    queryKey: ['reasoning', runId, reasoningId],
    queryFn: () => request(reasoningTextSchema, `/runs/${runId}/reasoning/${reasoningId}`),
    enabled: live === undefined,
    staleTime: Infinity,
  });
  const text = live ?? saved.data?.text;
  return (
    <div id={id} className="step-thought" role="group" aria-label="Thinking" tabIndex={0}>
      {text === undefined
        ? saved.isError
          ? "Couldn't load the thinking."
          : 'Loading…'
        : text.trim() === '' && !streaming
          ? 'No thinking text was shared.'
          : text}
    </div>
  );
}
