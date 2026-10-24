import type { SparkRules } from '@spark-outpost/contracts';
import { WarnIcon } from '../../ui/icons.tsx';
import { unusedKindLabel } from './rule-rows.ts';

function entriesTitle(count: number): string {
  return count === 1
    ? "1 entry in your file isn't used"
    : `${count} entries in your file aren't used`;
}

export function UnusedEntries({ rules }: { rules: SparkRules }) {
  if (rules.unused.length === 0) return null;
  return (
    <section className="rules-panel" aria-labelledby="rules-unused">
      <h4 id="rules-unused">{entriesTitle(rules.unused.length)}</h4>
      <p className="set-hint">Spark keeps them in the file and leaves them alone.</p>
      <ul>
        {rules.unused.map((entry, index) => (
          <li key={`${index}:${entry.entry}`}>
            <code>{entry.entry}</code>
            <span>{unusedKindLabel(entry.kind)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RulesFileProblems({ rules }: { rules: SparkRules }) {
  const company = rules.problems.filter((problem) => problem.file === 'managed');
  const broken = rules.malformed
    ? rules.problems.find((problem) => problem.file === 'user')
    : undefined;
  if (!broken && company.length === 0) return null;
  return (
    <div className="rules-alert" role="alert">
      <WarnIcon />
      <div>
        {broken && (
          <p>
            <b>settings.json can&apos;t be used.</b> {broken.message}. Fix the file to change rules
            here.
          </p>
        )}
        {company.map((problem) => (
          <p key={problem.message}>Your company&apos;s file: {problem.message}.</p>
        ))}
      </div>
    </div>
  );
}
