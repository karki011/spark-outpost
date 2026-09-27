import './permission-options.css';
import {
  INVOLVEMENT_LEVELS,
  PERMISSION_DO,
  doDisclosure,
  levelHint,
  type Choice,
  type InvolvementLevel,
} from '@spark-outpost/contracts';

interface PermissionOptionsProps {
  provider: string | null;
  choices: Choice[];
  selected: string | null;
  level: InvolvementLevel | null;
  hasRepos: boolean;
  onSelect: (permission: string) => void;
  onLevel: (level: InvolvementLevel) => void;
}

export function PermissionOptions({
  provider,
  choices,
  selected,
  level,
  hasRepos,
  onSelect,
  onLevel,
}: PermissionOptionsProps) {
  const doing = selected === PERMISSION_DO;
  return (
    <>
      <div className="rlist" role="radiogroup" aria-label="Mode">
        {choices.map((choice) => {
          const unavailable = choice.unavailableReason !== null;
          return (
            <button
              key={choice.id}
              type="button"
              className={unavailable ? 'rrow unavailable' : 'rrow'}
              role="radio"
              aria-checked={choice.id === selected}
              aria-disabled={unavailable}
              title={choice.unavailableReason ?? undefined}
              onClick={() => {
                if (!unavailable) onSelect(choice.id);
              }}
            >
              <i className="radio" />
              <span>
                <b>
                  {choice.label}
                  {unavailable && <span className="rtag">Unavailable</span>}
                </b>
                <small>{choice.unavailableReason ?? choice.description}</small>
              </span>
            </button>
          );
        })}
      </div>
      {doing && (
        <div className="rlist levels" role="radiogroup" aria-label="Involvement level">
          <p className="mgroup">How involved do you want to be?</p>
          {INVOLVEMENT_LEVELS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="rrow"
              role="radio"
              aria-checked={option.id === level}
              onClick={() => onLevel(option.id)}
            >
              <i className="radio" />
              <span>
                <b>{option.label}</b>
                <small>{levelHint(option, provider)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="eff-note">
        {!hasRepos
          ? "This chat has no project folder, so it runs as a plain chat: your AI can't read or change files whichever you pick."
          : doing
            ? doDisclosure(provider)
            : 'Ask reads the linked repos and never changes them.'}
      </p>
    </>
  );
}
