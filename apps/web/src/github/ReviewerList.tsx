import { useId, type KeyboardEvent } from 'react';
import { TickIcon } from '../ui/icons.tsx';
import {
  NO_REVIEWER_KEY,
  reviewerKey,
  type ReviewerGroups,
  type ReviewerOption,
} from './auto-review-model.ts';

interface ReviewerListProps {
  groups: ReviewerGroups;
  value: string;
  describedBy: string;
  onPick: (reviewer: ReviewerOption | null) => void;
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
  if (options.length === 0) return;
  const index = options.indexOf(document.activeElement as HTMLElement);
  let next: number | null = null;
  if (event.key in STEPS) next = (index + STEPS[event.key]! + options.length) % options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  if (next === null) return;
  event.preventDefault();
  options[next]?.focus();
}

interface OptionProps {
  label: string;
  selected: boolean;
  onPick: () => void;
}

function Option({ label, selected, onPick }: OptionProps) {
  return (
    <div
      role="option"
      className="ar-option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onPick();
      }}
    >
      <span className="ar-option-name">{label}</span>
      {selected && <TickIcon />}
    </div>
  );
}

function Group({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: readonly ReviewerOption[];
  value: string;
  onPick: (reviewer: ReviewerOption) => void;
}) {
  const titleId = useId();
  if (options.length === 0) return null;
  return (
    <div role="group" aria-labelledby={titleId}>
      <div id={titleId} className="ar-group">
        {title}
      </div>
      {options.map((option) => (
        <Option
          key={reviewerKey(option)}
          label={option.name}
          selected={reviewerKey(option) === value}
          onPick={() => onPick(option)}
        />
      ))}
    </div>
  );
}

export function ReviewerList({ groups, value, describedBy, onPick }: ReviewerListProps) {
  return (
    <div
      role="listbox"
      className="ar-list"
      aria-label="Review with"
      aria-describedby={describedBy}
      onKeyDown={moveFocus}
    >
      <Option label="None" selected={value === NO_REVIEWER_KEY} onPick={() => onPick(null)} />
      <Group title="Sparks" options={groups.sparks} value={value} onPick={onPick} />
      <Group title="Workflows" options={groups.workflows} value={value} onPick={onPick} />
    </div>
  );
}
