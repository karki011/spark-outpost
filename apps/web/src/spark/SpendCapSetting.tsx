import { useState } from 'react';
import { SPEND_CAP_MAX_USD, spendCapUsdSchema } from '@spark-outpost/contracts';
import { useProfileSetting } from '../settings/use-profile-setting.ts';
import { SwitchValueSetting } from './SwitchValueSetting.tsx';

const DEFAULT_CAP_USD = 5;

const INFO = {
  lead: 'When a task’s agent spend reaches this amount, Spark pauses it and asks.',
  items: [
    { label: 'Continue', text: 'Allows another round of the same amount.' },
    { label: 'Spend', text: 'What the agents report, or an estimate from their token counts.' },
    { label: 'Applies to', text: 'Tasks started after you change it.' },
  ],
  footer: 'Direct chats with Spark off aren’t capped.',
};

const RANGE_HINT = `Enter an amount from $0.01 to $${SPEND_CAP_MAX_USD.toLocaleString('en-US')}.`;

function dollars(usd: number): string {
  return usd.toFixed(2);
}

function parsedCap(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '');
  if (trimmed === '') return null;
  const parsed = spendCapUsdSchema.safeParse(Number(trimmed));
  return parsed.success ? Math.round(parsed.data * 100) / 100 : null;
}

export function SpendCapSetting({ usd }: { usd: number | null }) {
  const setting = useProfileSetting(usd, (value) => ({ spendCapUsd: value }));
  const [lastCap, setLastCap] = useState(usd ?? DEFAULT_CAP_USD);
  const [draft, setDraft] = useState<string | null>(null);
  const cap = setting.value;
  const invalid = draft !== null && parsedCap(draft) === null;

  const commit = () => {
    if (draft === null) return;
    const next = parsedCap(draft);
    if (next === null) return;
    setDraft(null);
    setLastCap(next);
    if (next !== cap) setting.set(next);
  };

  const hint =
    setting.error ??
    (invalid
      ? RANGE_HINT
      : cap === null
        ? 'No spend limit per task.'
        : `Spark asks before a task spends more than $${dollars(cap)}.`);

  return (
    <SwitchValueSetting
      label="Spend cap per task"
      blob="coin"
      info={INFO}
      hint={hint}
      on={cap !== null}
      onToggle={(on) => {
        setDraft(null);
        setting.set(on ? lastCap : null);
      }}
    >
      {(hintId) => (
        <span className="spark-money">
          <span aria-hidden="true">$</span>
          <input
            className="inp spark-num"
            inputMode="decimal"
            aria-label="Spend cap in US dollars"
            aria-describedby={hintId}
            aria-invalid={invalid || undefined}
            value={draft ?? dollars(cap ?? lastCap)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commit();
            }}
          />
        </span>
      )}
    </SwitchValueSetting>
  );
}
