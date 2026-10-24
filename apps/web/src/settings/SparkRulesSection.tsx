import './spark-rules.css';
import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NEVER_ALLOWED_NOTE,
  WORKFLOW_PREFIXES,
  ghPrefixProblem,
  tidyGhPrefix,
  type GhRuleChoice,
  type RuleStanding,
  type SparkRules,
  type UpdateSparkRulesRequest,
} from '@spark-outpost/contracts';
import { sparkRulesApi, sparkRulesKey } from '../api/spark-rules.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { LockIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { SettingRow } from './SettingRow.tsx';

export const READ_LABEL = 'Read anything';
export const OWN_PULL_LABEL = "This chat's pull request";
export const WORKFLOW_LABEL = 'Run a workflow';
export const OTHER_LABEL = 'Other commands';
export const ALLOWED_LABEL = 'Allowed commands';

export const SPARK_RULES_ROWS = [
  READ_LABEL,
  OWN_PULL_LABEL,
  WORKFLOW_LABEL,
  OTHER_LABEL,
  ALLOWED_LABEL,
];

const DOC = { page: 'protected-paths', heading: 'spark-rules' };
const ON_THE_MAC = 'Spark rules change on the Mac.';
const WORKFLOW_COMMANDS = WORKFLOW_PREFIXES.join(', ');

const WORKFLOW_CHOICES: { id: GhRuleChoice; label: string }[] = [
  { id: 'refused', label: 'Refused' },
  { id: 'mode', label: "Follows the agent's mode" },
];

const STANDING_LABEL: Record<RuleStanding, string> = {
  refused: 'Refused',
  asks: 'Asks',
  mode: "Follows the agent's mode",
};

const FLOOR_LABEL: Record<string, string> = {
  Push: 'Push when nothing allows publishing',
  PullRequest: 'Open a pull request when nothing allows it',
  'Push(other)': "Push a branch that isn't the chat's own",
  'Push(force)': 'Force push',
  GitRemote: 'Change remotes or use other hosting tools',
  'SecretFile(edit)': 'Change or use secret files',
  'SecretFile(read)': 'Read files listed in .sparkignore',
  'InstructionFile(edit)': 'Change agent instruction files',
  GitConfig: 'Change git hooks or config',
  WriteOutside: 'Write or delete outside the project',
  SecretSend: 'Send a value from a secret file',
};

const FLOOR_HINT = "Set in settings.json. A rule that isn't set follows the agent's mode.";

function useRulesSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: UpdateSparkRulesRequest) => sparkRulesApi.save(update),
    onSuccess: (rules) => queryClient.setQueryData(sparkRulesKey, rules),
  });
}

function WorkflowRow({ rules, locked }: { rules: SparkRules; locked: boolean }) {
  const hintId = useId();
  const save = useRulesSave();
  const value =
    save.isPending && save.variables?.workflows ? save.variables.workflows : rules.workflows;
  const shown: RuleStanding = rules.workflows === 'refused' ? 'refused' : 'mode';
  const mixed = rules.workflowCommands.some((command) => command.standing !== shown);
  const perCommand = rules.workflowCommands
    .map((command) => `${command.prefix}: ${STANDING_LABEL[command.standing]}`)
    .join(' · ');
  const hint =
    save.error?.message ??
    (mixed && !save.isPending ? `${perCommand}. Choosing a setting sets all three.` : null) ??
    (value === 'mode'
      ? `${WORKFLOW_COMMANDS} run at once in Auto, Bypass permissions, Approve for me and Full access, and with a card otherwise. It counts as a send.`
      : `${WORKFLOW_COMMANDS} are refused in every mode, with a card to allow them.`);
  return (
    <SettingRow label={WORKFLOW_LABEL} hint={locked ? ON_THE_MAC : hint} hintId={hintId} doc={DOC}>
      <div className="rules-control">
        {locked ? (
          <span className="rules-fixed">{WORKFLOW_CHOICES.find((c) => c.id === value)?.label}</span>
        ) : (
          <ChoicePicker
            label={WORKFLOW_LABEL}
            choices={WORKFLOW_CHOICES}
            value={value}
            onChange={(id) => save.mutate({ workflows: id as GhRuleChoice })}
          />
        )}
      </div>
    </SettingRow>
  );
}

function AllowedRow({ rules, locked }: { rules: SparkRules; locked: boolean }) {
  const hintId = useId();
  const inputId = useId();
  const save = useRulesSave();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const allowed = rules.ghAllowed;
  const add = (event: FormEvent) => {
    event.preventDefault();
    const prefix = tidyGhPrefix(draft);
    const found = ghPrefixProblem(prefix);
    if (found) {
      setProblem(found);
      return;
    }
    setProblem(null);
    save.mutate({ ghAllowed: [...allowed, prefix] }, { onSuccess: () => setDraft('') });
  };
  const hint =
    problem ??
    save.error?.message ??
    `Commands you add follow the agent's mode. ${NEVER_ALLOWED_NOTE}`;
  return (
    <SettingRow
      label={ALLOWED_LABEL}
      {...(locked ? {} : { controlId: inputId })}
      hint={locked ? ON_THE_MAC : hint}
      hintId={hintId}
    >
      <div className="rules-allowed">
        {allowed.length > 0 && (
          <ul aria-label={ALLOWED_LABEL}>
            {allowed.map((prefix) => (
              <li key={prefix}>
                <code>{prefix}</code>
                {!locked && (
                  <button
                    type="button"
                    className="btn sm"
                    aria-label={`Remove ${prefix}`}
                    disabled={save.isPending}
                    onClick={() =>
                      save.mutate({ ghAllowed: allowed.filter((entry) => entry !== prefix) })
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!locked && (
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
      </div>
    </SettingRow>
  );
}

function FixedRow({ label, hint, status }: { label: string; hint: string; status: string }) {
  const hintId = useId();
  return (
    <SettingRow label={label} hint={hint} hintId={hintId}>
      <span className="rules-fixed">{status}</span>
    </SettingRow>
  );
}

function LockedRow({ label, hint }: { label: string; hint: string }) {
  const hintId = useId();
  return (
    <SettingRow label={label} hint={hint} hintId={hintId}>
      <span className="rules-fixed rules-locked">
        <LockIcon />
        Fixed
      </span>
    </SettingRow>
  );
}

function RulesRows({ rules }: { rules: SparkRules }) {
  const { remote } = useRemoteClient();
  return (
    <>
      <section className="spark-group" aria-labelledby="rules-github">
        <h4 id="rules-github">GitHub commands</h4>
        <FixedRow
          label={READ_LABEL}
          hint="gh pr view, gh run list, gh api GETs and other reads."
          status="Always allowed"
        />
        <FixedRow
          label={OWN_PULL_LABEL}
          hint="Create, edit, comment and reply to threads, when publishing is allowed."
          status="Publish rules"
        />
        <WorkflowRow rules={rules} locked={remote} />
        <FixedRow
          label={OTHER_LABEL}
          hint="Close, other pull requests, releases, repo settings."
          status={STANDING_LABEL[rules.otherCommands]}
        />
        <AllowedRow rules={rules} locked={remote} />
      </section>
      <section className="spark-group" aria-labelledby="rules-floor">
        <h4 id="rules-floor">Safety rules</h4>
        {rules.floor.map((row) => (
          <FixedRow
            key={row.rule}
            label={FLOOR_LABEL[row.rule] ?? row.rule}
            hint={FLOOR_HINT}
            status={STANDING_LABEL[row.standing]}
          />
        ))}
        <LockedRow
          label="Never merge, approve or dismiss reviews"
          hint="Spark never merges, whatever the rules say."
        />
      </section>
    </>
  );
}

export function SparkRulesSection() {
  const rules = useQuery({ queryKey: sparkRulesKey, queryFn: sparkRulesApi.get });
  return (
    <>
      <p className="lede">
        What Spark lets a chat&apos;s agent do, on top of the agent&apos;s own mode. Terminal
        sessions aren&apos;t affected.
      </p>
      <QueryWait query={rules} what="Spark rules">
        <Skeleton label="Loading Spark rules" rows={4} />
      </QueryWait>
      {rules.data && <RulesRows rules={rules.data} />}
    </>
  );
}
