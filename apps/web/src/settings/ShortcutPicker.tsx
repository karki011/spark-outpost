import { useState, type KeyboardEvent } from 'react';
import { acceleratorFromKey, shortcutKeys } from '../desktop/shortcut-keys.ts';
import { Keys } from '../ui/Keys.tsx';
import './shortcut-picker.css';

export const RECORDING_HINT = 'Press the new keys, or Escape to cancel.';

export function useShortcutPicker(save: (next: string | null) => Promise<string | null>) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (next: string | null) => setError(await save(next));
  return { recording, setRecording, error, pick };
}

export function ShortcutPicker({
  label,
  accelerator,
  isDefault,
  describedBy,
  picker,
}: {
  label: string;
  accelerator: string;
  isDefault: boolean;
  describedBy: string;
  picker: ReturnType<typeof useShortcutPicker>;
}) {
  const { recording, setRecording, pick } = picker;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    const next = acceleratorFromKey(event);
    if (!next) return;
    setRecording(false);
    void pick(next);
  };
  return (
    <span className="desk-shortcut">
      <Keys keys={shortcutKeys(accelerator)} />
      <button
        type="button"
        className="btn line sm"
        aria-describedby={describedBy}
        aria-label={recording ? `Recording ${label}` : `Change ${label}`}
        onClick={() => setRecording(!recording)}
        onKeyDown={onKeyDown}
        onBlur={() => setRecording(false)}
      >
        {recording ? 'Press keys…' : 'Change'}
      </button>
      <button
        type="button"
        className="btn ghost sm"
        disabled={isDefault}
        onClick={() => void pick(null)}
        aria-label={`Reset ${label}`}
      >
        Reset
      </button>
    </span>
  );
}
