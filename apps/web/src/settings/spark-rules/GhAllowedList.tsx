import { useId, useRef, useState, type FormEvent } from 'react';
import {
  GH_ALLOWED_MAX,
  NEVER_ALLOWED_NOTE,
  ghPrefixProblem,
  tidyGhPrefix,
  type GhAllowedEntry,
  type GhAllowedRequest,
} from '@spark-outpost/contracts';
import { sparkRulesApi } from '../../api/spark-rules.ts';
import { useSettingFocus } from '../setting-focus.ts';
import { ALLOWED_LABEL } from './rule-rows.ts';
import { useRulesWrite } from './use-spark-rules.ts';

const FULL = `Spark rules hold ${GH_ALLOWED_MAX} allowed commands. Remove one first.`;

function ruleOf(prefix: string): string {
  return `Gh(${prefix.replace(/^gh /, '')})`;
}

interface GhAllowedListProps {
  entries: readonly GhAllowedEntry[];
  editable: boolean;
}

export function GhAllowedList({ entries, editable }: GhAllowedListProps) {
  const hintId = useId();
  const inputId = useId();
  const row = useRef<HTMLDivElement>(null);
  const control = useRef<HTMLDivElement>(null);
  useSettingFocus(ALLOWED_LABEL, row, control);
  const save = useRulesWrite((change: GhAllowedRequest) => sparkRulesApi.setGhAllowed(change));
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = (event: FormEvent) => {
    event.preventDefault();
    const prefix = tidyGhPrefix(draft);
    const found =
      ghPrefixProblem(prefix) ??
      (entries.length >= GH_ALLOWED_MAX && !entries.some((entry) => entry.prefix === prefix)
        ? FULL
        : null);
    setProblem(found);
    if (found) return;
    save.mutate({ prefix, allowed: true }, { onSuccess: () => setDraft('') });
  };
  const hint =
    problem ??
    save.error?.message ??
    `Each one follows the agent's mode, even when other gh commands are refused. ${NEVER_ALLOWED_NOTE}`;
  return (
    <div ref={row} className="rules-allowed">
      <label className="rules-label" htmlFor={editable ? inputId : undefined}>
        {ALLOWED_LABEL}
      </label>
      <div ref={control} className="rules-allowed-body">
        {entries.length > 0 && (
          <ul aria-label={ALLOWED_LABEL}>
            {entries.map((entry) => (
              <li key={entry.prefix}>
                <span className="rules-what">
                  <span>{entry.prefix}</span>
                  <code>{ruleOf(entry.prefix)}</code>
                  {entry.overridden && (
                    <small className="rules-note">
                      Your company refuses it, so it stays refused.
                    </small>
                  )}
                </span>
                {editable && (
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Remove ${entry.prefix}`}
                    disabled={save.isPending}
                    onClick={() => save.mutate({ prefix: entry.prefix, allowed: false })}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form className="rules-add" onSubmit={add}>
            <input
              id={inputId}
              className="inp mono"
              placeholder="gh release create"
              value={draft}
              aria-describedby={hintId}
              aria-invalid={problem ? true : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className="btn primary sm"
              disabled={save.isPending || draft.trim() === ''}
            >
              Add
            </button>
          </form>
        )}
        <p id={hintId} className="set-hint" aria-live="polite">
          {hint}
        </p>
      </div>
    </div>
  );
}
