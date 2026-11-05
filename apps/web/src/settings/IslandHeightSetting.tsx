import './island-height-setting.css';
import { useEffect, useId, useRef, useState } from 'react';
import { ISLAND_HEIGHT_RANGE } from '@spark-outpost/contracts';
import type { CompanionStatus } from '../desktop/desktop-bridge.ts';
import { SettingRow } from './SettingRow.tsx';

export const ISLAND_HEIGHT_LABEL = 'Spark Island height';
const ADJUST_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function heightLabel(value: number): string {
  return value === 0 ? 'Default' : `${Math.abs(value)} px ${value < 0 ? 'higher' : 'lower'}`;
}

export function IslandHeightSetting({
  status,
  onChange,
  onPreview,
}: {
  status: CompanionStatus;
  onChange?: ((height: number) => Promise<CompanionStatus>) | undefined;
  onPreview?: ((height: number) => Promise<CompanionStatus>) | undefined;
}) {
  const id = useId();
  const hintId = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const original = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (original.current !== null && !pending.current)
        void onPreview?.(original.current).catch(() => undefined);
    },
    [onPreview],
  );
  const saved = status.islandHeight ?? ISLAND_HEIGHT_RANGE.default;
  const value = draft ?? saved;
  const unsupported = !status.supported || !onChange;
  const disabled = unsupported || saving;

  const preview = (next: number) => {
    if (pending.current || unsupported) return;
    original.current ??= saved;
    setDraft(next);
    cancelFrame();
    if (onPreview)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        void onPreview(next).catch(() =>
          setError('Could not preview the height. Release to save.'),
        );
      });
  };
  const cancel = () => {
    cancelFrame();
    if (original.current !== null) void onPreview?.(original.current).catch(() => undefined);
    original.current = null;
    setDraft(null);
  };
  const commit = async (next: number) => {
    if (!onChange || !status.supported || pending.current) return;
    cancelFrame();
    if (original.current === null && next === saved) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
      original.current = null;
      setDraft(null);
    } catch {
      setError('Could not save the height. Try again.');
      cancel();
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return (
    <SettingRow
      label={ISLAND_HEIGHT_LABEL}
      controlId={id}
      hintId={hintId}
      doc={{ page: 'desktop-companion', heading: 'turn-it-on-and-size-it' }}
      disabled={disabled}
      hint={
        error ??
        (!onChange
          ? 'Update the Mac app to adjust the height.'
          : onPreview
            ? 'Moves the resting blob. Open panels stay clear of the notch.'
            : 'Moves the resting blob. Release to apply; open panels stay clear of the notch.')
      }
    >
      <div className="island-height">
        <div className="island-height-range">
          <input
            id={id}
            type="range"
            min={ISLAND_HEIGHT_RANGE.min}
            max={ISLAND_HEIGHT_RANGE.max}
            step={1}
            value={value}
            disabled={unsupported}
            aria-disabled={saving || undefined}
            aria-describedby={hintId}
            aria-valuetext={heightLabel(value)}
            onChange={(event) => preview(Number(event.currentTarget.value))}
            onPointerDown={(event) => {
              if (pending.current) event.preventDefault();
              else event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (pending.current && ADJUST_KEYS.has(event.key)) event.preventDefault();
            }}
            onPointerUp={(event) => void commit(Number(event.currentTarget.value))}
            onPointerCancel={cancel}
            onKeyUp={(event) => {
              if (ADJUST_KEYS.has(event.key)) void commit(Number(event.currentTarget.value));
            }}
            onBlur={(event) => void commit(Number(event.currentTarget.value))}
          />
          <div className="island-height-labels" aria-hidden="true">
            <span>Higher</span>
            <span>{heightLabel(value)}</span>
            <span>Lower</span>
          </div>
        </div>
        <button
          type="button"
          className="btn ghost sm"
          aria-label="Reset Spark Island height"
          disabled={disabled || value === ISLAND_HEIGHT_RANGE.default}
          onClick={() => {
            setDraft(ISLAND_HEIGHT_RANGE.default);
            void commit(ISLAND_HEIGHT_RANGE.default);
          }}
        >
          Reset
        </button>
      </div>
    </SettingRow>
  );
}
