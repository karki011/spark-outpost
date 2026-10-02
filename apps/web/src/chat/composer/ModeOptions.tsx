import './mode-options.css';
import { useId } from 'react';
import {
  combinationLine,
  combinationWarning,
  type AgentModeOption,
  type InvolvementLevel,
} from '@spark-outpost/contracts';
import { RadioRow } from '../../ui/RadioRow.tsx';
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
      {hasRepos && <p className="eff-note mode-line">{combinationLine(facts)}</p>}
      {warning && (
        <p className="mode-warn" role="note">
          {warning}
        </p>
      )}
    </div>
  );
}
