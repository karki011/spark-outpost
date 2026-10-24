import { useRef, type ReactNode } from 'react';
import type { SparkRuleChoice, SparkRuleRowState } from '@spark-outpost/contracts';
import { ChoicePicker } from '../../ui/ChoicePicker.tsx';
import { CheckIcon, LockIcon, XIcon } from '../../ui/icons.tsx';
import { useSettingFocus } from '../setting-focus.ts';
import { choiceLabel, choicesFor, type RuleRowCopy } from './rule-rows.ts';

export function ChoiceMark({ choice }: { choice: SparkRuleChoice }) {
  if (choice === 'allow') {
    return (
      <span className="rule-mark allow">
        <CheckIcon className="" />
      </span>
    );
  }
  if (choice === 'deny') {
    return (
      <span className="rule-mark deny">
        <XIcon />
      </span>
    );
  }
  if (choice === 'ask') return <span className="rule-mark ask rule-dot" aria-hidden="true" />;
  return null;
}

interface RuleLineProps {
  label: string;
  ids: readonly string[];
  children: ReactNode;
}

export function RuleLine({ label, ids, children }: RuleLineProps) {
  const row = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  useSettingFocus(label, row, control);
  return (
    <div ref={row} className="rules-row">
      <div className="rules-what">
        <span className="rules-label">{label}</span>
        <span className="rules-ids">
          {ids.map((id) => (
            <code key={id}>{id}</code>
          ))}
        </span>
      </div>
      <div ref={control} className="rules-right">
        {children}
      </div>
    </div>
  );
}

export function SourceTag({ source }: { source: SparkRuleRowState['source'] | 'fixed' }) {
  if (source === 'user') return <span className="rules-source">Your file</span>;
  if (source === null) return null;
  return (
    <span className="rules-source">
      <LockIcon />
      {source === 'managed' ? 'Your company' : 'Always'}
    </span>
  );
}

export function FixedChoice({ label, choice }: { label: string; choice: SparkRuleChoice | null }) {
  return (
    <span className="rules-fixed-choice">
      {choice && <ChoiceMark choice={choice} />}
      {label}
    </span>
  );
}

interface RuleRowProps {
  copy: RuleRowCopy;
  state: SparkRuleRowState;
  editable: boolean;
  onChange: (choice: SparkRuleChoice) => void;
}

export function RuleRow({ copy, state, editable, onChange }: RuleRowProps) {
  const locked = state.source === 'managed';
  const current = state.choice === null ? 'Mixed' : choiceLabel(copy.row, state.choice);
  const choices = choicesFor(copy.row).map((choice) => ({
    ...choice,
    icon: <ChoiceMark choice={choice.id} />,
  }));
  return (
    <RuleLine label={copy.label} ids={state.ids}>
      <SourceTag source={state.source} />
      {editable && !locked ? (
        <div className={`rules-choice${state.choice === 'mode' ? ' is-mode' : ''}`}>
          <ChoicePicker
            label={copy.label}
            choices={choices}
            value={state.choice ?? ''}
            placeholder="Mixed"
            onChange={(id) => onChange(id as SparkRuleChoice)}
          />
        </div>
      ) : (
        <FixedChoice label={current} choice={state.choice} />
      )}
    </RuleLine>
  );
}
