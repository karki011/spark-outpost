import {
  providerName,
  type CrewMember,
  type RunMode,
  type WorkflowRunStep,
} from '@spark-outpost/contracts';
import { shortLabel } from '../chat/composer/model-options.ts';
import { Markdown } from '../chat/markdown/Markdown.tsx';
import { BellIcon, ForwardIcon } from '../ui/icons.tsx';
import { stepElapsed } from './run-model.ts';
import { RunStepState } from './RunState.tsx';
import type { CrewSpark } from './spark-lookup.ts';

const MODE_WORDS: Record<RunMode, string> = {
  ask: 'Read-only: reads and runs commands, changes no files',
  chat: 'Chat only: no tools',
  do: 'May change files',
};

const NO_NOTE: Record<WorkflowRunStep['state'], string> = {
  waiting: 'This step has not started.',
  running: 'Working. Its note shows here when it finishes.',
  succeeded: 'This step finished without a note.',
  failed: 'This step failed without saying why.',
  skipped: 'This step did not start, so it has no note.',
  cancelled: 'This step was cancelled before it wrote a note.',
};

interface RunStepPanelProps {
  step: WorkflowRunStep;
  label: string;
  spark: CrewSpark | undefined;
  member: CrewMember | undefined;
  approvalId: string | null;
  passedTo: readonly { stepId: string; label: string }[];
  now: number;
  inChat: boolean;
  onSelect: (stepId: string) => void;
  onOpenTurn: () => void;
  onOpenCard: (approvalId: string) => void;
}

function agentText(member: CrewMember | undefined): string {
  if (!member) return 'Not started';
  const model = member.modelLabel ?? (member.model ? shortLabel(member.model) : null);
  return [providerName(member.provider), model].filter(Boolean).join(' · ');
}

export function RunStepPanel({
  step,
  label,
  spark,
  member,
  approvalId,
  passedTo,
  now,
  inChat,
  onSelect,
  onOpenTurn,
  onOpenCard,
}: RunStepPanelProps) {
  const elapsed = stepElapsed(step, now);
  return (
    <section className="wf-run-panel" aria-label={`Step ${label}`}>
      <header className="wf-run-panel-head">
        <h3>{label}</h3>
        <RunStepState state={step.state} asking={approvalId !== null} />
      </header>
      {approvalId !== null && (
        <div className="wf-run-ask">
          <BellIcon />
          <span>
            <b>Waiting for your answer.</b> This step asked to run something. Answer its card in the
            chat.
          </span>
          <button type="button" className="btn line sm" onClick={() => onOpenCard(approvalId)}>
            Open the card
          </button>
        </div>
      )}
      <dl className="wf-run-facts">
        <dt>Spark</dt>
        <dd>{spark ? [spark.name, spark.role].filter(Boolean).join(' · ') : 'Missing Spark'}</dd>
        <dt>Agent</dt>
        <dd>{agentText(member)}</dd>
        <dt>Mode</dt>
        <dd>{member?.mode ? MODE_WORDS[member.mode] : 'Not started'}</dd>
        <dt>Time</dt>
        <dd>{elapsed ?? 'Not started'}</dd>
      </dl>
      <h4>Output</h4>
      {step.note ? (
        <div className="wf-run-note">
          <Markdown text={step.note} />
        </div>
      ) : (
        <p className="wf-hint">{NO_NOTE[step.state]}</p>
      )}
      <h4>Passed to</h4>
      {passedTo.length === 0 ? (
        <p className="wf-hint">No later step. Its note goes back to the chat.</p>
      ) : (
        <ul className="wf-run-next" aria-label={`Steps ${label} is passed to`}>
          {passedTo.map((next) => (
            <li key={next.stepId}>
              <button type="button" className="btn line sm" onClick={() => onSelect(next.stepId)}>
                {next.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {inChat && step.runId !== null && (
        <button type="button" className="btn ghost sm wf-run-turn" onClick={onOpenTurn}>
          <ForwardIcon />
          Open this step in the chat
        </button>
      )}
    </section>
  );
}
