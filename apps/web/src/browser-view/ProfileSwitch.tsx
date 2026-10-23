import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { BrowserProfile } from '@spark-outpost/contracts';
import { LockIcon, SparkleIcon } from '../ui/icons.tsx';

const PROFILES: { id: BrowserProfile; label: string; icon: ReactNode; note: string }[] = [
  {
    id: 'personal',
    label: 'Personal',
    icon: <LockIcon />,
    note: 'Agents can’t open or read these tabs',
  },
  { id: 'work', label: 'Work', icon: <SparkleIcon />, note: 'Shared with every chat’s agent' },
];

export function profileNote(profile: BrowserProfile): string {
  return PROFILES.find((item) => item.id === profile)!.note;
}

export function ProfileBadge({ profile }: { profile: BrowserProfile }) {
  const item = PROFILES.find((candidate) => candidate.id === profile)!;
  return (
    <span className="bv-badge" data-profile={profile}>
      {item.icon}
      {item.label}
    </span>
  );
}

interface ProfileSwitchProps {
  profile: BrowserProfile;
  onChange(profile: BrowserProfile): void;
}

export function ProfileSwitch({ profile, onChange }: ProfileSwitchProps) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = PROFILES.findIndex((item) => item.id === profile);
    const next = PROFILES[(index + step + PROFILES.length) % PROFILES.length]!;
    onChange(next.id);
    group.current?.querySelector<HTMLElement>(`[data-profile="${next.id}"]`)?.focus();
  };
  return (
    <div
      ref={group}
      className="bv-profiles"
      role="radiogroup"
      aria-label="Browser profile"
      onKeyDown={onKeyDown}
    >
      {PROFILES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="radio"
          data-profile={item.id}
          className="bv-profile"
          aria-checked={profile === item.id}
          tabIndex={profile === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
