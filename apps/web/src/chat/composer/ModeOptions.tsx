import './mode-options.css';
import { useId } from 'react';
import {
  AUTONOMY_LEVELS,
  combinationLine,
  combinationWarning,
  type AgentModeOption,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { withCurrentMode } from './mode-summary.ts';

interface ModeOptionsProps {
  provider: string;
  modes: AgentModeOption[];
  defaultMode: string | null;
  selected: string | null;
  level: InvolvementLevel;
  hasRepos: boolean;
  loading: boolean;
  onMode: (mode: string) => void;
  onLevel: (level: InvolvementLevel) => void;
}

interface RadioRowProps {
  id: string;
  label: string;
  hint: string | null;
  tag?: string | null;
  checked: boolean;
  onSelect: () => void;
}

function RadioRow({ id, label, hint, tag = null, checked, onSelect }: RadioRowProps) {
  const tagId = `${id}-tag`;
  const hintId = `${id}-hint`;
  const described = [tag ? tagId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className="rrow"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={described || undefined}
      onClick={onSelect}
    >
      <i className="radio" />
      <span>
        <b>
          {label}
          {tag && (
            <span className="mtag" id={tagId}>
              {tag}
            </span>
          )}
        </b>
        {hint && <small id={hintId}>{hint}</small>}
      </span>
    </button>
  );
}

export function ModeOptions({
  provider,
  modes,
  defaultMode,
  selected,
  level,
  hasRepos,
  loading,
  onMode,
  onLevel,
}: ModeOptionsProps) {
  const prefix = useId();
  const shown = withCurrentMode(modes, selected);
  const kind = shown.find((mode) => mode.id === selected)?.kind ?? null;
  const facts = { provider, mode: selected, kind, level, hasRepos };
  const warning = combinationWarning(facts);
  return (
    <div className="modeopts">
      <p className="mgroup" id={`${prefix}-mode`}>
        Agent mode
      </p>
      <div className="rlist" role="radiogroup" aria-labelledby={`${prefix}-mode`}>
        {shown.length === 0 && (
          <p className="mempty">
            {loading ? 'Asking the agent for its modes…' : 'No modes reported yet.'}
          </p>
        )}
        {shown.map((mode) => (
          <RadioRow
            key={mode.id}
            id={`${prefix}-m-${mode.id}`}
            label={mode.label}
            hint={mode.description}
            tag={mode.id === defaultMode ? 'Default' : null}
            checked={mode.id === selected}
            onSelect={() => onMode(mode.id)}
          />
        ))}
      </div>
      <p className="mgroup" id={`${prefix}-level`}>
        Harness autonomy
      </p>
      <div className="rlist" role="radiogroup" aria-labelledby={`${prefix}-level`}>
        {AUTONOMY_LEVELS.map((info) => (
          <RadioRow
            key={info.id}
            id={`${prefix}-l-${info.id}`}
            label={info.label}
            hint={info.hint}
            checked={info.id === level}
            onSelect={() => onLevel(info.id)}
          />
        ))}
      </div>
      <p className="eff-note mode-line">{combinationLine(facts)}</p>
      {warning && (
        <p className="mode-warn" role="note">
          {warning}
        </p>
      )}
    </div>
  );
}
