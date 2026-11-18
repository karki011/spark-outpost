import { useRef, type KeyboardEvent } from 'react';
import type { GithubInboxGroup, GithubInboxItem } from '@spark-outpost/contracts';
import { CheckIcon } from '../ui/icons.tsx';
import { GROUP_LABEL, GROUPS, tileLine } from './github-model.ts';

interface GithubTilesProps {
  grouped: Record<GithubInboxGroup, GithubInboxItem[]>;
  value: GithubInboxGroup;
  now: number;
  onChange: (group: GithubInboxGroup) => void;
}

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function GithubTiles({ grouped, value, now, onChange }: GithubTilesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const index = GROUPS.indexOf(value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key in STEPS) next = (index + STEPS[event.key]! + GROUPS.length) % GROUPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = GROUPS.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(GROUPS[next]!);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div
      ref={ref}
      className="gh-tiles"
      role="radiogroup"
      aria-label="Pull request groups"
      onKeyDown={onKeyDown}
    >
      {GROUPS.map((group) => {
        const items = grouped[group];
        const line = tileLine(group, items, now);
        const checked = group === value;
        const fresh = group === 'review_requested' && items.some((item) => item.unseen);
        return (
          <button
            key={group}
            type="button"
            role="radio"
            className="gh-tile"
            data-group={group}
            aria-checked={checked}
            aria-label={`${GROUP_LABEL[group]}, ${items.length}, ${line}`}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(group)}
          >
            <b className="gh-count">{items.length}</b>
            <span className="gh-tile-label">{GROUP_LABEL[group]}</span>
            <small className={fresh ? 'gh-tile-line fresh' : 'gh-tile-line'}>
              {fresh && <i className="gh-dot" aria-hidden="true" />}
              {line}
            </small>
            {checked && <CheckIcon className="gh-tile-check" />}
          </button>
        );
      })}
    </div>
  );
}
