import { INVOLVEMENT_LEVEL_IDS, type InvolvementLevel } from '@spark-outpost/contracts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { READ_ONLY_PULL, pullHint, pullLabel } from './story-draft.ts';

interface PullFieldProps {
  level: InvolvementLevel;
  stackedOn: string | null;
  readOnly: boolean;
  onChange: (level: InvolvementLevel) => void;
}

const LABEL = 'Pull request';
const ORDER: readonly InvolvementLevel[] = ['full-auto', 'hands-off'];

function isLevel(id: string): id is InvolvementLevel {
  return INVOLVEMENT_LEVEL_IDS.some((level) => level === id);
}

export function PullField({ level, stackedOn, readOnly, onChange }: PullFieldProps) {
  if (readOnly) {
    return (
      <div className="field">
        <span>{LABEL}</span>
        <p className="op-sheet-note">{READ_ONLY_PULL}</p>
      </div>
    );
  }
  return (
    <div className="field">
      <span>{LABEL}</span>
      <ChoicePicker
        label={LABEL}
        choices={ORDER.map((id) => ({
          id,
          label: pullLabel(id, stackedOn),
          description: pullHint(id, stackedOn),
        }))}
        value={level}
        onChange={(id) => {
          if (isLevel(id)) onChange(id);
        }}
      />
    </div>
  );
}
