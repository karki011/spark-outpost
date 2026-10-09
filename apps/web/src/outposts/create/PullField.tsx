import { INVOLVEMENT_LEVEL_IDS, type InvolvementLevel } from '@spark-outpost/contracts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { pullHint, pullLabel } from './story-draft.ts';

interface PullFieldProps {
  level: InvolvementLevel;
  stackedOn: string | null;
  onChange: (level: InvolvementLevel) => void;
}

const LABEL = 'Pull request';
const ORDER: readonly InvolvementLevel[] = ['full-auto', 'hands-off'];

function isLevel(id: string): id is InvolvementLevel {
  return INVOLVEMENT_LEVEL_IDS.some((level) => level === id);
}

export function PullField({ level, stackedOn, onChange }: PullFieldProps) {
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
