import { useId } from 'react';
import type {
  ConfigChoice,
  ConfigOptionInfo,
  ConfigValue,
  ConfigValues,
} from '@spark-outpost/contracts';
import { TickIcon } from '../../ui/icons.tsx';
import { BlobSwitchFace } from '../../brand/BlobToggle.tsx';

interface ConfigOptionsProps {
  options: ConfigOptionInfo[];
  values: ConfigValues;
  onChange: (id: string, value: ConfigValue) => void;
}

export function optionValue(option: ConfigOptionInfo, values: ConfigValues): ConfigValue {
  const chosen = values[option.id];
  if (option.type === 'boolean') return typeof chosen === 'boolean' ? chosen : option.currentValue;
  return typeof chosen === 'string' ? chosen : option.currentValue;
}

export function choiceGroups(choices: readonly ConfigChoice[]): [string | null, ConfigChoice[]][] {
  const groups = new Map<string | null, ConfigChoice[]>();
  for (const choice of choices) {
    groups.set(choice.group, [...(groups.get(choice.group) ?? []), choice]);
  }
  return [...groups];
}

function SwitchOption({
  option,
  checked,
  onChange,
}: {
  option: Extract<ConfigOptionInfo, { type: 'boolean' }>;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const hintId = useId();
  return (
    <button
      type="button"
      className="mopt copt"
      role="switch"
      aria-checked={checked}
      aria-label={option.name}
      aria-describedby={option.description ? hintId : undefined}
      onClick={() => onChange(!checked)}
    >
      <span>
        <b>{option.name}</b>
        {option.description && <small id={hintId}>{option.description}</small>}
      </span>
      <BlobSwitchFace checked={checked} />
    </button>
  );
}

function SelectOption({
  option,
  selected,
  onChange,
}: {
  option: Extract<ConfigOptionInfo, { type: 'select' }>;
  selected: string;
  onChange: (value: string) => void;
}) {
  const headingId = useId();
  return (
    <div className="copt-select">
      <p className="mgroup" id={headingId}>
        {option.name}
      </p>
      {option.description && <p className="copt-hint">{option.description}</p>}
      <div role="radiogroup" aria-labelledby={headingId}>
        {choiceGroups(option.choices).map(([group, choices]) => (
          <div key={group ?? ''} role={group ? 'group' : undefined} aria-label={group ?? undefined}>
            {group && <p className="copt-group">{group}</p>}
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="mopt"
                role="radio"
                aria-checked={choice.id === selected}
                onClick={() => onChange(choice.id)}
              >
                <span>
                  <b>{choice.label}</b>
                  {choice.description && (
                    <small title={choice.description}>{choice.description}</small>
                  )}
                </span>
                <TickIcon />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConfigOptions({ options, values, onChange }: ConfigOptionsProps) {
  return (
    <div className="copts">
      {options.map((option) =>
        option.type === 'boolean' ? (
          <SwitchOption
            key={option.id}
            option={option}
            checked={optionValue(option, values) === true}
            onChange={(value) => onChange(option.id, value)}
          />
        ) : (
          <SelectOption
            key={option.id}
            option={option}
            selected={String(optionValue(option, values))}
            onChange={(value) => onChange(option.id, value)}
          />
        ),
      )}
    </div>
  );
}
