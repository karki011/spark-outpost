import './schedule.css';
import { useId, useState, type ReactNode } from 'react';
import {
  BRANCH_GLOB_MAX,
  TRIGGER_DEBOUNCE_MAX,
  type WorkflowTriggers,
  type WorkflowTriggersView,
} from '@spark-outpost/contracts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import { CheckIcon, WarnIcon } from '../ui/icons.tsx';
import { TriggerActivity } from './TriggerActivity.tsx';
import { defaultTriggers, triggerProblem, triggersSummary } from './triggers-model.ts';
import { useSaveTriggers, useWorkflowTriggers } from './use-triggers.ts';

const ANY_PROJECT = 'any';

interface TriggersTabProps {
  workflowId: string;
  name: string;
}

interface SwitchProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}

function TriggerSwitch({ label, hint, checked, onChange, children }: SwitchProps) {
  const id = useId();
  return (
    <div className="wf-sched-field">
      <div className="wf-sched-switch">
        <BlobToggle
          label={label}
          checked={checked}
          describedBy={`${id}-hint`}
          onChange={onChange}
        />
        <span>
          <b>{label}</b>
          <small id={`${id}-hint`}>{hint}</small>
        </span>
      </div>
      {checked && children}
    </div>
  );
}

function TriggersForm({
  workflowId,
  name,
  view,
}: TriggersTabProps & { view: WorkflowTriggersView }) {
  const ids = useId();
  const projects = useProjects();
  const save = useSaveTriggers(workflowId);
  const [saved, setSaved] = useState(() => view.triggers ?? defaultTriggers());
  const [draft, setDraft] = useState(saved);
  const adder = useAddFolder({
    onAdded: (project) => setDraft((current) => ({ ...current, projectId: project.id })),
  });
  const edit = (patch: Partial<WorkflowTriggers>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const problem = triggerProblem(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const store = () =>
    save.mutate(draft, {
      onSuccess: () => setSaved(draft),
    });
  const choices = [
    { id: ANY_PROJECT, label: 'Any project' },
    ...(projects.data ?? []).map((project) => ({ id: project.id, label: project.name })),
  ];

  return (
    <div className="wf-body">
      <div className="wf-col wf-sched" role="group" aria-label={`Triggers of ${name}`}>
        <p className="wf-hint" role="status">
          {triggersSummary(saved)}
        </p>
        <p className="wf-hint">
          A triggered run works in the chat that triggered it, on that chat’s worktree and branch,
          and posts its findings there. It is not your message: it can’t ask for a push, a pull
          request or a Spark action.
        </p>

        <TriggerSwitch
          label="A chat starts"
          hint="Once per chat, after the first message you send in a new chat, when that first turn ends."
          checked={draft.chatStarted}
          onChange={(chatStarted) => edit({ chatStarted })}
        />
        <TriggerSwitch
          label="A turn changes files"
          hint="After a Do turn in a chat keeps changes."
          checked={draft.turnChanged}
          onChange={(turnChanged) => edit({ turnChanged })}
        />
        <TriggerSwitch
          label="Before publish"
          hint="At Full auto → PR, before Spark pushes the branch and opens the pull request."
          checked={draft.beforePublish}
          onChange={(beforePublish) =>
            edit({ beforePublish, holdOnFindings: beforePublish && draft.holdOnFindings })
          }
        >
          <label className="wf-sched-line">
            <input
              type="checkbox"
              checked={draft.holdOnFindings}
              onChange={(event) => edit({ holdOnFindings: event.target.checked })}
            />
            Hold the publish while Critical or High findings are open
          </label>
        </TriggerSwitch>
        <TriggerSwitch
          label="A new commit on the branch"
          hint="When a chat’s branch has a new commit after a turn, including one Spark made."
          checked={draft.commit}
          onChange={(commit) => edit({ commit })}
        >
          <label htmlFor={`${ids}-branch`}>Only on branches</label>
          <input
            id={`${ids}-branch`}
            className="inp"
            maxLength={BRANCH_GLOB_MAX}
            value={draft.branchGlob}
            placeholder="spark/*, main"
            onChange={(event) => edit({ branchGlob: event.target.value })}
          />
          <p className="wf-hint">
            Leave empty for every branch. * stays inside one part, ** crosses /.
          </p>
        </TriggerSwitch>
        <TriggerSwitch
          label="A pull request opens or updates"
          hint="For pull requests Spark opened, when one opens or gets a new head."
          checked={draft.pullRequest}
          onChange={(pullRequest) => edit({ pullRequest })}
        />

        <div className="wf-sched-field">
          <span>In project</span>
          <ChoicePicker
            label="In project"
            choices={choices}
            value={draft.projectId ?? ANY_PROJECT}
            actions={adder.actions}
            onChange={(id) => edit({ projectId: id === ANY_PROJECT ? null : id })}
          />
          {adder.flow}
        </div>

        <div className="wf-sched-field">
          <label htmlFor={`${ids}-wait`}>Wait after the last trigger (minutes)</label>
          <input
            id={`${ids}-wait`}
            className="inp wf-sched-num"
            type="number"
            inputMode="numeric"
            min={0}
            max={TRIGGER_DEBOUNCE_MAX}
            value={draft.debounceMinutes}
            onChange={(event) =>
              edit({ debounceMinutes: Number.parseInt(event.target.value, 10) || 0 })
            }
          />
          <p className="wf-hint">
            Triggers in the same chat during the wait start one run. A run is skipped when nothing
            changed since the last one.
          </p>
        </div>

        <TriggerSwitch
          label="Triggered and scheduled runs may change files"
          hint="Steps on Claude may edit files in the chat’s own worktree and leave them uncommitted. Commits, pushes and pull requests stay refused. Runs before publish only read."
          checked={draft.edits}
          onChange={(edits) => edit({ edits })}
        />

        {problem !== null && (
          <p className="wf-problem" role="status">
            <WarnIcon />
            <span>
              <b>Can’t save yet</b> · {problem}
            </span>
          </p>
        )}
        {save.error && (
          <p className="wf-problem wf-error" role="alert">
            <WarnIcon />
            <span>
              <b>Couldn’t save</b> · {save.error.message}
            </span>
          </p>
        )}
        <div className="wf-sched-line">
          <button
            type="button"
            className="btn primary sm"
            disabled={problem !== null || !dirty || save.isPending}
            onClick={store}
          >
            Save triggers
          </button>
          <span role="status">
            {dirty && <span className="wf-hint">Not saved</span>}
            {!dirty && view.triggers !== null && (
              <span className="wf-state" data-state="succeeded">
                <CheckIcon className="wf-state-ic" />
                Saved
              </span>
            )}
          </span>
        </div>
      </div>
      <TriggerActivity workflowId={workflowId} view={view} />
    </div>
  );
}

export function TriggersTab({ workflowId, name }: TriggersTabProps) {
  const view = useWorkflowTriggers(workflowId);
  if (view.error) {
    return (
      <p className="wf-problem wf-error" role="alert">
        <WarnIcon />
        <span>
          <b>Couldn’t load the triggers</b> · {view.error.message}
        </span>
      </p>
    );
  }
  if (!view.data) return <div className="wf-body" aria-busy="true" />;
  return <TriggersForm workflowId={workflowId} name={name} view={view.data} />;
}
