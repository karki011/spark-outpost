import type { ReactNode } from 'react';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { NO_PARENT, type AfterChoice } from './story-draft.ts';

interface DependsFieldProps {
  choices: readonly AfterChoice[];
  value: string | null;
  problem: ReactNode;
  onChange: (key: string | null) => void;
}

const LABEL = 'Starts after';

export function DependsField({ choices, value, problem, onChange }: DependsFieldProps) {
  const options = [
    { id: NO_PARENT, label: 'Nothing', description: 'Starts right away' },
    ...choices.map((choice) => ({
      id: choice.key,
      label: `@${choice.handle}`,
      description: `Waits until @${choice.handle} has answered`,
    })),
  ];
  const known = choices.some((choice) => choice.key === value);
  return (
    <div className="field">
      <span>{LABEL}</span>
      <ChoicePicker
        label={LABEL}
        choices={options}
        value={known && value !== null ? value : NO_PARENT}
        onChange={(key) => onChange(key === NO_PARENT ? null : key)}
      />
      {problem}
    </div>
  );
}
