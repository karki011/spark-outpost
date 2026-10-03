import { useId, useState } from 'react';
import { compactionThresholdError, reaskPercent, type Profile } from '@spark-outpost/contracts';
import { SettingRow } from '../settings/SettingRow.tsx';
import { useProfileSetting } from '../settings/use-profile-setting.ts';
import { SwitchValueSetting } from './SwitchValueSetting.tsx';

const WARN_INFO = {
  lead: 'The context ring in the composer turns amber at this point.',
  items: [
    { label: 'Range', text: 'From 30% to 90%, at least 5 points below the compaction point.' },
    { label: 'Applies to', text: 'Every chat, from its next reply.' },
  ],
  footer: 'A warning only; nothing is compacted.',
};

const COMPACT_INFO = {
  lead: 'Before your next message, Spark shrinks the agent’s context to a summary.',
  items: [
    { label: 'On', text: 'Spark compacts and notes it in the work log.' },
    { label: 'Keep going', text: 'The card returns 10 points later, at most at 95%.' },
    { label: 'Off', text: 'Spark only warns and offers the card; it never compacts by itself.' },
  ],
  footer: 'The full transcript always stays in the chat.',
};

type Check = (percent: number) => string | null;

function parsedPercent(text: string): number {
  const trimmed = text.trim().replace(/%$/, '').trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

function usePercentField(saved: number, check: Check, onCommit: (percent: number) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const error = draft === null ? null : check(parsedPercent(draft));
  return {
    value: draft ?? String(saved),
    error,
    edit: setDraft,
    reset: () => setDraft(null),
    commit: () => {
      if (draft === null || error) return;
      const next = parsedPercent(draft);
      setDraft(null);
      if (next !== saved) onCommit(next);
    },
  };
}

type PercentField = ReturnType<typeof usePercentField>;

function PercentInput({
  label,
  field,
  hintId,
}: {
  label: string;
  field: PercentField;
  hintId: string;
}) {
  return (
    <span className="spark-money">
      <input
        className="inp spark-num spark-pct"
        inputMode="numeric"
        aria-label={label}
        aria-describedby={hintId}
        aria-invalid={field.error ? true : undefined}
        value={field.value}
        onChange={(event) => field.edit(event.target.value)}
        onBlur={field.commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          field.commit();
        }}
      />
      <span aria-hidden="true">%</span>
    </span>
  );
}

function WarnSetting({ profile }: { profile: Profile }) {
  const hintId = useId();
  const setting = useProfileSetting(profile.compactWarnPercent, (value) => ({
    compactWarnPercent: value,
  }));
  const field = usePercentField(
    setting.value,
    (percent) => compactionThresholdError(percent, profile.compactAtPercent),
    setting.set,
  );
  const hint =
    field.error ?? setting.error ?? `The context ring turns amber at ${setting.value}% full.`;
  return (
    <SettingRow
      label="Warn when context is"
      info={WARN_INFO}
      doc={{ page: 'compaction', heading: 'change-when-spark-compacts' }}
      hint={hint}
      hintId={hintId}
    >
      <PercentInput label="Warn when context is, in percent" field={field} hintId={hintId} />
    </SettingRow>
  );
}

function compactHint(on: boolean, percent: number): string {
  if (!on)
    return `Spark only warns and offers the card at ${percent}%; it never compacts by itself.`;
  return `Spark compacts at ${percent}% and asks again at ${reaskPercent(percent)}% after Keep going.`;
}

function CompactAtSetting({ profile }: { profile: Profile }) {
  const at = useProfileSetting(profile.compactAtPercent, (value) => ({ compactAtPercent: value }));
  const on = useProfileSetting(profile.autoCompact, (value) => ({ autoCompact: value }));
  const field = usePercentField(
    at.value,
    (percent) => compactionThresholdError(profile.compactWarnPercent, percent),
    at.set,
  );
  const hint = field.error ?? at.error ?? on.error ?? compactHint(on.value, at.value);
  return (
    <SwitchValueSetting
      label="Compact automatically at"
      blob="plain"
      info={COMPACT_INFO}
      doc={{ page: 'compaction', heading: 'change-when-spark-compacts' }}
      hint={hint}
      on={on.value}
      onToggle={(value) => {
        field.reset();
        on.set(value);
      }}
    >
      {(hintId) => (
        <PercentInput label="Compact automatically at, in percent" field={field} hintId={hintId} />
      )}
    </SwitchValueSetting>
  );
}

export function CompactionSettings({ profile }: { profile: Profile }) {
  return (
    <section className="spark-group" aria-labelledby="spark-compaction">
      <h4 id="spark-compaction">Context compaction</h4>
      <WarnSetting profile={profile} />
      <CompactAtSetting profile={profile} />
    </section>
  );
}
