import { useId, useState } from 'react';
import { DEFAULT_AUTO_CONTINUE_SECONDS } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import { SettingRow } from './SettingRow.tsx';
import {
  CUSTOM_WAIT_ID,
  parsedWait,
  presetSeconds,
  WAIT_OPTIONS,
  WAIT_RANGE_HINT,
  waitChoiceId,
  waitHint,
} from './auto-continue-model.ts';
import { useProfileSetting } from './use-profile-setting.ts';

const LABEL = 'Wait before going on without your answer';

const WAIT_INFO =
  'Covers the "This chat is almost full" question: if you do not answer, Spark keeps going without compacting. Typing in the card stops the countdown. Approvals always wait for you.';

export function AutoContinueSetting({ seconds }: { seconds: number | null }) {
  const hintId = useId();
  const setting = useProfileSetting(seconds, (value: number | null) => ({
    autoContinueSeconds: value,
  }));
  const saved = setting.value;
  const [custom, setCustom] = useState(() => waitChoiceId(seconds) === CUSTOM_WAIT_ID);
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parsedWait(draft) === null;

  const commit = () => {
    if (draft === null) return;
    const next = parsedWait(draft);
    if (next === null) return;
    setDraft(null);
    if (next !== saved) setting.set(next);
  };

  const pick = (id: string) => {
    setDraft(null);
    if (id === CUSTOM_WAIT_ID) {
      setCustom(true);
      return;
    }
    const preset = presetSeconds(id);
    if (preset === undefined) return;
    setCustom(false);
    if (preset !== saved) setting.set(preset);
  };

  return (
    <SettingRow
      label={LABEL}
      hint={setting.error ?? (invalid ? WAIT_RANGE_HINT : waitHint(saved))}
      hintId={hintId}
      info={WAIT_INFO}
      doc={{ page: 'approvals', heading: 'if-you-dont-answer' }}
    >
      <span className="set-wait">
        <Segmented
          ariaLabel={LABEL}
          describedBy={hintId}
          options={WAIT_OPTIONS}
          value={custom ? CUSTOM_WAIT_ID : waitChoiceId(saved)}
          onChange={pick}
        />
        {custom && (
          <span className="set-wait-custom">
            <input
              className="inp set-wait-num"
              inputMode="numeric"
              aria-label="Custom wait in seconds"
              aria-describedby={hintId}
              aria-invalid={invalid || undefined}
              value={draft ?? String(saved ?? DEFAULT_AUTO_CONTINUE_SECONDS)}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commit();
              }}
            />
            <span aria-hidden="true">seconds</span>
          </span>
        )}
      </span>
    </SettingRow>
  );
}
