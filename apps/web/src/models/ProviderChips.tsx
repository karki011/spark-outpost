import { useRef, type KeyboardEvent } from 'react';
import type { ProviderCardsView } from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { ALL_PROVIDERS } from './model-list.ts';

interface Chip {
  id: string;
  label: string;
  count: number;
  view: ProviderCardsView | null;
}

interface ProviderChipsProps {
  providers: readonly ProviderCardsView[];
  value: string;
  onChange: (provider: string) => void;
}

const NEXT_KEYS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

function AllMark() {
  return (
    <svg className="mc-all" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="2" />
      <rect x="13" y="4" width="7" height="7" rx="2" />
      <rect x="4" y="13" width="7" height="7" rx="2" />
      <rect x="13" y="13" width="7" height="7" rx="2" />
    </svg>
  );
}

export function ProviderChips({ providers, value, onChange }: ProviderChipsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const chips: Chip[] = [
    {
      id: ALL_PROVIDERS,
      label: 'All',
      count: providers.reduce((sum, view) => sum + view.models.length, 0),
      view: null,
    },
    ...providers.map((view) => ({
      id: view.provider.provider,
      label: view.provider.label,
      count: view.models.length,
      view,
    })),
  ];

  const select = (index: number) => {
    const chip = chips[(index + chips.length) % chips.length]!;
    onChange(chip.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-provider="${chip.id}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = chips.findIndex((chip) => chip.id === value);
    const step = NEXT_KEYS[event.key];
    if (step !== undefined) select(current + step);
    else if (event.key === 'Home') select(0);
    else if (event.key === 'End') select(chips.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={listRef}
      className="mc-chips"
      role="radiogroup"
      aria-label="Show models from"
      onKeyDown={onKeyDown}
    >
      {chips.map((chip) => {
        const checked = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-provider={chip.id}
            className={chip.view && !chip.view.connected ? 'mc-chip off' : 'mc-chip'}
            onClick={() => onChange(chip.id)}
          >
            {chip.view ? (
              <ProviderBlob
                providerId={chip.view.provider.provider}
                size={22}
                expression={chip.view.connected ? 'idle' : 'sleepy'}
              />
            ) : (
              <AllMark />
            )}
            <span className="mc-chip-name">{chip.label}</span>
            <span className="mc-count">
              {chip.count}
              <span className="sr-only"> {chip.count === 1 ? 'model' : 'models'}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
