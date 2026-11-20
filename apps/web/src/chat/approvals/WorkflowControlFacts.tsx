import type { WorkflowControlAction, WorkflowTriggers } from '@spark-outpost/contracts';
import { scheduleSummary } from '../../crew-flows/schedule-model.ts';
import { hourCycle } from '../../desktop/hour-cycle.ts';

const TRIGGER_WORDS: [keyof WorkflowTriggers, string][] = [
  ['chatStarted', 'a chat starts'],
  ['turnChanged', 'a turn changes files'],
  ['beforePublish', 'before publish'],
  ['commit', 'a new commit'],
  ['pullRequest', 'a pull request'],
];

function triggersText(triggers: WorkflowTriggers): string {
  const on = TRIGGER_WORDS.filter(([key]) => triggers[key] === true).map(([, words]) => words);
  return on.length > 0 ? `On ${on.join(', ')}` : 'No triggers';
}

function triggerRights(triggers: WorkflowTriggers): string {
  const edits = triggers.edits ? 'Runs may change files' : 'Runs only read';
  return triggers.holdOnFindings ? `${edits}; findings hold the publish` : edits;
}

function change(before: string | null, after: string): string {
  return before === null || before === after ? after : `${before} → ${after}`;
}

export function WorkflowControlFacts({ action }: { action: WorkflowControlAction }) {
  return (
    <dl className="sac-facts">
      <dt>Workflow</dt>
      <dd>{action.name}</dd>
      {action.op === 'run' && (
        <>
          <dt>Where</dt>
          <dd>A new chat{action.project ? ` in ${action.project.name}` : ''}</dd>
        </>
      )}
      {action.message && (
        <>
          <dt>Message</dt>
          <dd>{action.message}</dd>
        </>
      )}
      {action.schedule && (
        <>
          <dt>Schedule</dt>
          <dd>
            {change(
              action.scheduleBefore ? scheduleSummary(action.scheduleBefore, hourCycle()) : 'None',
              scheduleSummary(action.schedule, hourCycle()),
            )}
          </dd>
        </>
      )}
      {action.triggers && (
        <>
          <dt>Triggers</dt>
          <dd>
            {change(
              action.triggersBefore ? triggersText(action.triggersBefore) : null,
              triggersText(action.triggers),
            )}
          </dd>
          <dt>Runs</dt>
          <dd>
            {change(
              action.triggersBefore ? triggerRights(action.triggersBefore) : null,
              triggerRights(action.triggers),
            )}
          </dd>
        </>
      )}
    </dl>
  );
}
