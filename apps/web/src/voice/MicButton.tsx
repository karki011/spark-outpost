import './speech.css';
import { MicIcon } from '../ui/icons.tsx';
import { useDictation } from './use-dictation.ts';

interface MicButtonProps {
  onText: (text: string) => void;
  className?: string;
}

export function MicButton({ onText, className = 'icon-btn' }: MicButtonProps) {
  const dictation = useDictation(onText);
  if (!dictation.available) return null;
  const { state } = dictation;
  const partial = state.phase === 'listening' || state.phase === 'working' ? state.partial : '';
  const label = dictation.active ? 'Stop dictating' : 'Dictate';
  return (
    <span className="mic-wrap">
      {(partial || dictation.problem || dictation.active) && (
        <span className="mic-status" aria-live="polite">
          {partial ? (
            <span className="mic-partial">{partial}</span>
          ) : dictation.active ? (
            state.phase === 'working' ? (
              'Working it out…'
            ) : (
              'Listening… Esc to cancel'
            )
          ) : (
            dictation.problem
          )}
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
        <MicIcon />
      </button>
    </span>
  );
}
