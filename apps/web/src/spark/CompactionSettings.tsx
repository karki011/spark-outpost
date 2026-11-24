import { useId, useState } from 'react';
import { compactionThresholdError, reaskPercent, type Profile } from '@spark-outpost/contracts';
import { ProfileSwitchSetting } from '../settings/ProfileSwitchSetting.tsx';
import { SettingRow } from '../settings/SettingRow.tsx';
import { useProfileSetting } from '../settings/use-profile-setting.ts';
import { SwitchValueSetting } from './SwitchValueSetting.tsx';

export const WARN_LABEL = 'Warn when context is';
export const COMPACT_LABEL = 'Compact automatically at';
export const IDLE_COMPACT_LABEL = 'Compact idle conversations';
export const BREAK_LABEL = 'Compact at a natural break';

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

const IDLE_INFO = {
  lead: 'Lets Claude compact a long conversation left idle about an hour, so your next message isn’t sent uncached.',
  items: [
    {
      label: 'Applies to',
      text: 'Claude chats from their next message, and new Claude Terminal sessions.',
    },
    { label: 'Trade-off', text: 'A summary can drop detail the agent had.' },
    { label: 'Sleeping', text: 'A turn sleeping until a wakeup can be compacted too.' },
    {
      label: 'Not counted',
      text: 'In a chat it runs between turns, so its tokens and cost aren’t recorded.',
    },
  ],
  footer: 'Off, Spark keeps Claude from compacting idle conversations. Codex is unchanged.',
};

const BREAK_INFO = {
  lead: 'Past the warning point, Spark compacts before your next message when the last turn ended at a natural break.',
  items: [
    {
      label: 'Natural break',
      text: 'The agent finished its plan, or opened a pull request.',
    },
    { label: 'Automatic off', text: 'The card asks at the break instead.' },
    { label: 'Fallback', text: 'The compaction point still applies.' },
  ],
  footer: 'Never mid-reply or while a card waits.',
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
      label={WARN_LABEL}
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
      label={COMPACT_LABEL}
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

function breakHint(on: boolean, profile: Profile): string {
  if (!on) return `Spark waits for ${profile.compactAtPercent}%.`;
  const action = profile.autoCompact ? 'compacts' : 'asks with the card';
  return `From ${profile.compactWarnPercent}%, Spark ${action} when the last turn finished its plan or opened a pull request.`;
}

function BreakSetting({ profile }: { profile: Profile }) {
  return (
    <ProfileSwitchSetting
      enabled={profile.compactAtBreak}
      label={BREAK_LABEL}
      info={BREAK_INFO}
      doc={{ page: 'compaction', heading: 'change-when-spark-compacts' }}
      hint={(on) => breakHint(on, profile)}
      toUpdate={(value) => ({ compactAtBreak: value })}
    />
  );
}

export function CompactionSettings({ profile }: { profile: Profile }) {
  return (
    <section className="spark-group" aria-labelledby="spark-compaction">
      <h4 id="spark-compaction">Context compaction</h4>
      <WarnSetting profile={profile} />
      <CompactAtSetting profile={profile} />
      <ProfileSwitchSetting
        enabled={profile.compactIdleConversations}
        label={IDLE_COMPACT_LABEL}
        info={IDLE_INFO}
        doc={{ page: 'compaction', heading: 'compact-idle-chats' }}
        hint={(on) =>
          on
            ? 'Claude compacts a long chat or Terminal session left idle about an hour.'
            : 'Claude never compacts an idle chat or Terminal session.'
        }
        toUpdate={(value) => ({ compactIdleConversations: value })}
      />
      <BreakSetting profile={profile} />
    </section>
  );
}
