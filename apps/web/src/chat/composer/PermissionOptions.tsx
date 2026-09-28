import './permission-options.css';
import { useId } from 'react';
import {
  ACCESS_CHOICES,
  PERMISSION_DO,
  accessFor,
  accessHint,
  doDisclosure,
  type AccessChoice,
  type Choice,
  type InvolvementLevel,
} from '@spark-outpost/contracts';

interface PermissionOptionsProps {
  provider: string | null;
  choices: Choice[];
  selected: string | null;
  level: InvolvementLevel | null;
  hasRepos: boolean;
  onSelect: (choice: AccessChoice) => void;
}

export function unavailableReason(choices: readonly Choice[], choice: AccessChoice): string | null {
  const permission = choices.find((option) => option.id === choice.permission);
  if (!permission) return 'Not offered by this agent.';
  return permission.unavailableReason;
}

export function PermissionOptions({
  provider,
  choices,
  selected,
  level,
  hasRepos,
  onSelect,
}: PermissionOptionsProps) {
  const current = accessFor(selected, level);
  const hintPrefix = useId();
  return (
    <>
      <div className="rlist" role="radiogroup" aria-label="Permissions">
        {ACCESS_CHOICES.map((choice) => {
          const reason = unavailableReason(choices, choice);
          const unavailable = reason !== null;
          const hintId = `${hintPrefix}-${choice.id}`;
          return (
            <button
              key={choice.id}
              type="button"
              className={unavailable ? 'rrow unavailable' : 'rrow'}
              role="radio"
              aria-checked={choice.id === current?.id}
              aria-disabled={unavailable}
              aria-label={choice.label}
              aria-describedby={hintId}
              title={reason ?? undefined}
              onClick={() => {
                if (!unavailable) onSelect(choice);
              }}
            >
              <i className="radio" />
              <span>
                <b>
                  {choice.label}
                  {unavailable && <span className="rtag">Unavailable</span>}
                </b>
                <small id={hintId}>{reason ?? accessHint(choice, provider)}</small>
              </span>
            </button>
          );
        })}
      </div>
      <p className="eff-note">
        {!hasRepos
          ? "This chat has no project folder, so it runs as a plain chat: your AI can't read or change files whichever you pick."
          : selected === PERMISSION_DO
            ? doDisclosure(provider)
            : 'Ask reads the linked repos and never changes them.'}
      </p>
    </>
  );
}
