import './speech.css';
import { MicIcon } from '../ui/icons.tsx';
import type { useDictation } from './use-dictation.ts';

interface MicButtonProps {
  dictation: ReturnType<typeof useDictation>;
  className?: string;
}

export function MicButton({ dictation, className = 'icon-btn' }: MicButtonProps) {
  if (!dictation.available) return null;
  const { state } = dictation;
  const partial = state.phase === 'listening' || state.phase === 'working' ? state.partial : '';
  const label =
    state.phase === 'starting'
      ? 'Starting dictation'
      : state.phase === 'working'
        ? 'Transcribing dictation'
        : dictation.active
          ? 'Stop dictating'
          : 'Dictate';
  const status =
    state.phase === 'starting'
      ? 'Starting dictation…'
      : state.phase === 'working'
        ? 'Working it out…'
        : dictation.active
          ? partial || 'Listening… Esc to cancel'
          : '';
  return (
    <span className="mic-wrap">
      <span className="sr-only" role="status">
        {status}
      </span>
      {dictation.problem && (
        <span className="mic-error" role="alert">
          {dictation.problem}
        </span>
      )}
      <button
        type="button"
        className={`${className} mic-btn`}
        aria-label={label}
        aria-pressed={dictation.active}
        title={label}
        data-listening={dictation.active || undefined}
        onClick={dictation.toggle}
      >
        {dictation.active ? (
          <svg
            className="mic-wave"
            data-working={state.phase === 'working' || undefined}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="3" y="8" width="3" height="8" rx="1.5" />
            <rect x="8" y="4" width="3" height="16" rx="1.5" />
            <rect x="13" y="6" width="3" height="12" rx="1.5" />
            <rect x="18" y="9" width="3" height="6" rx="1.5" />
          </svg>
        ) : (
          <MicIcon />
        )}
      </button>
    </span>
  );
}
