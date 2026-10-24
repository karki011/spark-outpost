import './rule-diff.css';
import {
  rulesEditByline,
  rulesEditNote,
  type RuleLine,
  type RulesEditAction,
  type SparkAction,
} from '@spark-outpost/contracts';

export const RULES_ON_THE_MAC = 'Waiting for you on your Mac. Spark rules change there.';

interface DiffProps {
  add: readonly RuleLine[];
  remove: readonly RuleLine[];
  label: string;
}

export function RuleDiffList({ add, remove, label }: DiffProps) {
  return (
    <ul className="sac-rules" aria-label={label}>
      {add.map((line) => (
        <li key={`+${line.effect}${line.rule}`} className="sac-rule-add">
          <span aria-hidden="true">+ </span>
          <span className="sr-only">Add </span>
          {line.effect} {line.rule}
        </li>
      ))}
      {remove.map((line) => (
        <li key={`-${line.effect}${line.rule}`} className="sac-rule-del">
          <span aria-hidden="true">− </span>
          <span className="sr-only">Remove </span>
          {line.effect} {line.rule}
        </li>
      ))}
    </ul>
  );
}

export function RulesEditFacts({ action }: { action: RulesEditAction }) {
  return <RuleDiffList add={action.add} remove={action.remove} label="Rule changes" />;
}

export function rulesByline(action: SparkAction): string | null {
  return action.action === 'rules_edit' ? rulesEditByline(action) : null;
}

export function rulesNote(action: SparkAction): string | null {
  return action.action === 'rules_edit' ? rulesEditNote(action) : null;
}
