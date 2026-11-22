import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BRANCH_GLOB_MAX } from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { FieldProblem } from './FieldProblem.tsx';
import { matchingBranches } from './triggers-model.ts';
import { problemOf, type DraftProblem, type TriggersDraft } from './workflow-draft.ts';

interface TriggersCardProps {
  triggers: TriggersDraft;
  problems: readonly DraftProblem[];
  onChange: (triggers: TriggersDraft) => void;
}

interface TriggerRowProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}

function TriggerRow({ label, hint, checked, onChange, children }: TriggerRowProps) {
  const id = useId();
  return (
    <li className="wf-trigger">
      <div className="wf-trigger-head">
        <span>
          <b>{label}</b>
          <small id={`${id}-hint`}>{hint}</small>
        </span>
        <BlobToggle
          label={label}
          checked={checked}
          describedBy={`${id}-hint`}
          onChange={onChange}
        />
      </div>
      {checked && children}
    </li>
  );
}

function BranchPattern({ triggers, problems, onChange }: TriggersCardProps) {
  const id = useId();
  const chats = useQuery({ queryKey: queryKeys.conversations, queryFn: api.listConversations });
  const problem = problemOf(problems, 'branch');
  const matches = matchingBranches(
    triggers.branchGlob,
    (chats.data ?? []).filter((chat) => chat.archivedAt === null).map((chat) => chat.branch),
  );
  return (
    <div className="wf-sched-field">
      <label htmlFor={`${id}-branch`}>Only on branches</label>
      <input
        id={`${id}-branch`}
        className="inp wf-trigger-branch"
        maxLength={BRANCH_GLOB_MAX}
        value={triggers.branchGlob}
        placeholder="spark/*, main"
        aria-invalid={problem !== null || undefined}
        aria-describedby={`${id}-problem ${id}-matches`}
        onChange={(event) => onChange({ ...triggers, branchGlob: event.target.value })}
      />
      <FieldProblem id={`${id}-problem`} text={problem} />
      <p id={`${id}-matches`} className="wf-hint" role="status">
        {matches}
      </p>
      <p className="wf-hint">
        Leave empty for every branch. * stays inside one part, ** crosses /.
      </p>
    </div>
  );
}

export function TriggersCard(props: TriggersCardProps) {
  const { triggers, problems, onChange } = props;
  const ids = useId();
  const edit = (patch: Partial<TriggersDraft>) => onChange({ ...triggers, ...patch });
  const waitProblem = problemOf(problems, 'wait');
  return (
    <section className="wf-card-box" role="group" aria-labelledby={`${ids}-title`}>
      <header className="wf-card-head">
        <span>
          <h3 id={`${ids}-title`}>When something happens</h3>
          <small>
            Each one starts a run in the chat it happened in, on that chat’s worktree and branch. It
            is not your message: it can’t ask for a push, a pull request or a Spark action.
          </small>
        </span>
      </header>
      <ul className="wf-triggers">
        <TriggerRow
          label="A chat starts"
          hint="Once per chat, after the first message you send in a new chat, when that first turn succeeds."
          checked={triggers.chatStarted}
          onChange={(chatStarted) => edit({ chatStarted })}
        />
        <TriggerRow
          label="A turn changes files"
          hint="After a Do turn in a chat keeps changes."
          checked={triggers.turnChanged}
          onChange={(turnChanged) => edit({ turnChanged })}
        />
        <TriggerRow
          label="A new commit on the branch"
          hint="When a chat’s branch has a new commit after a turn, including one Spark made."
          checked={triggers.commit}
          onChange={(commit) => edit({ commit })}
        >
          <BranchPattern {...props} />
        </TriggerRow>
        <TriggerRow
          label="A pull request opens or updates"
          hint="For pull requests Spark opened, when one opens or gets a new head."
          checked={triggers.pullRequest}
          onChange={(pullRequest) => edit({ pullRequest })}
        />
        <TriggerRow
          label="Before publish"
          hint="At Full auto → PR, before Spark pushes the branch and opens the pull request. These runs only read."
          checked={triggers.beforePublish}
          onChange={(beforePublish) =>
            edit({ beforePublish, holdOnFindings: beforePublish && triggers.holdOnFindings })
          }
        >
          <label className="wf-check">
            <input
              type="checkbox"
              checked={triggers.holdOnFindings}
              onChange={(event) => edit({ holdOnFindings: event.target.checked })}
            />
            Hold the publish while Critical or High findings are open
          </label>
        </TriggerRow>
      </ul>
      <div className="wf-sched-line">
        <label htmlFor={`${ids}-wait`}>Wait</label>
        <input
          id={`${ids}-wait`}
          className="inp wf-sched-num"
          inputMode="numeric"
          value={triggers.debounceMinutes}
          aria-invalid={waitProblem !== null || undefined}
          aria-describedby={`${ids}-wait-problem ${ids}-wait-hint`}
          onChange={(event) => edit({ debounceMinutes: event.target.value })}
        />
        <span>minutes after the last trigger</span>
      </div>
      <FieldProblem id={`${ids}-wait-problem`} text={waitProblem} />
      <p id={`${ids}-wait-hint`} className="wf-hint">
        Triggers in the same chat during the wait start one run. A run is skipped when nothing
        changed since the last one. Before publish does not wait.
      </p>
    </section>
  );
}
