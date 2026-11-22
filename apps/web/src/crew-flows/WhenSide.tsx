import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { providerIdSchema, providerName, type WorkflowStep } from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery } from '../api/client.ts';
import { BlobToggle } from '../brand/BlobToggle.tsx';
import { modeLabel } from '../chat/composer/mode-summary.ts';
import { shortLabel } from '../chat/composer/model-options.ts';
import { useProjects } from '../chat/project/use-chat-repos.ts';
import { useAddFolder } from '../projects/use-add-folder.tsx';
import { ChoicePicker } from '../ui/ChoicePicker.tsx';
import type { CrewSpark } from './spark-lookup.ts';
import {
  ANY_PROJECT,
  MIXED_PROJECTS,
  setWhere,
  whereValue,
  type WorkflowDraft,
} from './workflow-draft.ts';

interface WhereCardProps {
  draft: WorkflowDraft;
  onChange: (draft: WorkflowDraft) => void;
}

export function WhereCard({ draft, onChange }: WhereCardProps) {
  const ids = useId();
  const projects = useProjects();
  const adder = useAddFolder({ onAdded: (project) => onChange(setWhere(draft, project.id)) });
  const value = whereValue(draft);
  const choices = [
    ...(value === MIXED_PROJECTS
      ? [{ id: MIXED_PROJECTS, label: 'Different for the schedule and the triggers' }]
      : []),
    {
      id: ANY_PROJECT,
      label: 'Any project',
      description: 'Triggers in every chat. Scheduled runs with no project.',
    },
    ...(projects.data ?? []).map((project) => ({
      id: project.id,
      label: project.name,
      description: project.displayPath,
    })),
  ];
  return (
    <section className="wf-card-box" role="group" aria-labelledby={`${ids}-title`}>
      <header className="wf-card-head">
        <span>
          <h3 id={`${ids}-title`}>Where</h3>
          <small id={`${ids}-hint`}>One setting for the schedule and every trigger.</small>
        </span>
      </header>
      <div className="wf-sched-field">
        <span>Project</span>
        <ChoicePicker
          label="Project"
          showNote={false}
          describedBy={`${ids}-hint`}
          choices={choices}
          value={value}
          actions={adder.actions}
          onChange={(id) => {
            if (id !== MIXED_PROJECTS) onChange(setWhere(draft, id === ANY_PROJECT ? null : id));
          }}
        />
        {adder.flow}
      </div>
      <p className="wf-hint" role="status">
        {value === MIXED_PROJECTS &&
          'The schedule and the triggers were saved with different projects. Picking one here sets both.'}
        {value === ANY_PROJECT &&
          'Triggers start runs in chats of any project. A scheduled run works in a chat with no project, from text alone.'}
        {value !== MIXED_PROJECTS &&
          value !== ANY_PROJECT &&
          'Triggers start runs only in this project’s chats. Scheduled runs work in this project.'}
      </p>
    </section>
  );
}

function ModeWords({ spark }: { spark: CrewSpark }) {
  const known = providerIdSchema.safeParse(spark.provider);
  const capabilities = useQuery({
    ...capabilitiesQuery(known.data ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: known.success && spark.agentMode !== null,
  });
  const agent = known.success
    ? [providerName(known.data), spark.model ? shortLabel(spark.model) : null]
        .filter(Boolean)
        .join(' · ')
    : 'Agent and model from the chat';
  const mode = spark.agentMode
    ? `${modeLabel(capabilities.data?.modes ?? [], spark.agentMode)} mode`
    : 'Mode from the chat';
  return (
    <>
      {agent} · {mode}
    </>
  );
}

interface MayDoCardProps {
  steps: readonly WorkflowStep[];
  sparkById: ReadonlyMap<string, CrewSpark>;
  edits: boolean;
  onEdits: (edits: boolean) => void;
  updateBase: boolean;
  onUpdateBase: (updateBase: boolean) => void;
}

export function MayDoCard(props: MayDoCardProps) {
  const { steps, sparkById, edits, onEdits, updateBase, onUpdateBase } = props;
  const ids = useId();
  const sparkIds = [...new Set(steps.map((step) => step.sparkId))];
  return (
    <section className="wf-card-box" role="group" aria-labelledby={`${ids}-title`}>
      <header className="wf-card-head">
        <span>
          <h3 id={`${ids}-title`}>What these runs may do</h3>
          <small>
            Every step reads and reports. Edits, commits, pushes, pull requests and installs are
            refused; other commands follow the Spark’s mode.
          </small>
        </span>
      </header>
      <dl className="wf-maydo">
        {sparkIds.map((sparkId) => {
          const spark = sparkById.get(sparkId);
          return (
            <div key={sparkId}>
              <dt>{spark?.name ?? 'Missing Spark'}</dt>
              <dd>{spark ? <ModeWords spark={spark} /> : 'This Spark no longer exists'}</dd>
            </div>
          );
        })}
      </dl>
      {sparkIds.length === 0 && <p className="wf-hint">No steps yet.</p>}
      <div className="wf-trigger-head">
        <span>
          <b>Triggered and scheduled runs may change files</b>
          <small id={`${ids}-edits`}>
            Steps on Claude may edit files in the chat’s own worktree and leave them uncommitted.
            Commits, pushes and pull requests stay refused. Runs before publish only read.
          </small>
        </span>
        <BlobToggle
          label="Triggered and scheduled runs may change files"
          checked={edits}
          describedBy={`${ids}-edits`}
          onChange={onEdits}
        />
      </div>
      <div className="wf-trigger-head">
        <span>
          <b>Steps may update the branch from its base</b>
          <small id={`${ids}-base`}>
            In any run in a chat with its own worktree, steps on Claude may merge the base into the
            chat’s branch, or rebase while it isn’t pushed yet, and edit files to resolve conflicts.
            Pushes stay refused. Runs before publish only read.
          </small>
        </span>
        <BlobToggle
          label="Steps may update the branch from its base"
          checked={updateBase}
          describedBy={`${ids}-base`}
          onChange={onUpdateBase}
        />
      </div>
      <p className="wf-hint">To change a Spark’s agent, model or mode, open it on the Crew tab.</p>
    </section>
  );
}
