import './workflow-card.css';
import { useState } from 'react';
import type { ConversationDetail, Orchestration, Project, Run } from '@spark-outpost/contracts';
import { RunState } from '../../crew-flows/RunState.tsx';
import { NEEDS_YOU } from '../../crew-flows/run-model.ts';
import { OpenRunViewButton } from '../../crew-flows/WorkflowRunLink.tsx';
import { useWorkflowRunOfTurn } from '../../crew-flows/use-workflow-runs.ts';
import { BellIcon, WorkflowIcon } from '../../ui/icons.tsx';
import { ApprovalCard } from '../approvals/ApprovalCard.tsx';
import { SparkJobs } from '../crew/SparkJobs.tsx';
import { agentAnchor } from '../../crew/conversation-crew.ts';
import { useWorkflowCardFocus } from './card-focus.ts';
import { clearRevealedStep, useRevealedStep } from './reveal-steps.ts';
import {
  pendingApprovals,
  runFindings,
  severityCounts,
  shownOnCard,
  stepMembers,
  SEVERITY_WORDS,
} from './workflow-card-model.ts';

interface WorkflowLineProps {
  run: Run;
  detail: ConversationDetail;
  orchestration: Orchestration | null;
  repo: Project | null;
}

export function WorkflowLine({ run, detail, orchestration, repo }: WorkflowLineProps) {
  const focus = useWorkflowCardFocus();
  const [stepsOpen, setStepsOpen] = useState(false);
  const revealed = useRevealedStep();
  const query = useWorkflowRunOfTurn(run.id, true);
  const workflowRun = query.data;
  if (!workflowRun) {
    if (!query.isError || !orchestration) return null;
    return (
      <SparkJobs run={run} detail={detail} orchestration={orchestration} repo={repo} collapsed />
    );
  }
  const members = stepMembers(detail, run.id);
  const memberRuns = new Set(members.map((member) => member.runId));
  const cards = detail.approvals.filter((approval) => memberRuns.has(approval.runId));
  const waiting = pendingApprovals(cards, members).length > 0;
  const showSteps =
    stepsOpen || members.some((member) => agentAnchor(run.id, member.runId) === revealed);
  const toggleSteps = () => {
    if (showSteps) clearRevealedStep();
    setStepsOpen(!showSteps);
  };
  const onCard =
    focus !== null &&
    !focus.dismissed.has(run.id) &&
    shownOnCard(workflowRun, run.id, detail, waiting);
  return (
    <>
      <p className="wfc-line">
        <WorkflowIcon />
        <b>{workflowRun.workflowName}</b>
        <RunState status={workflowRun.status} />
        {waiting && (
          <span className="wfc-need">
            <BellIcon />
            {NEEDS_YOU}
          </span>
        )}
        {severityCounts(runFindings(workflowRun)).map(({ severity, count }) => (
          <span key={severity} className="wfc-sev" data-severity={severity}>
            {count} {SEVERITY_WORDS[severity]}
          </span>
        ))}
        {onCard ? (
          <button
            type="button"
            className="btn ghost sm"
            aria-label={`Show ${workflowRun.workflowName} above the message box`}
            onClick={() => focus.setOpenTurn(run.id)}
          >
            Show
          </button>
        ) : (
          <OpenRunViewButton run={workflowRun} quiet />
        )}
        {orchestration && members.length > 0 && (
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={showSteps}
            onClick={toggleSteps}
          >
            Steps ({members.length})
          </button>
        )}
      </p>
      {orchestration && showSteps && (
        <SparkJobs
          run={run}
          detail={detail}
          orchestration={orchestration}
          repo={repo}
          collapsed
          pick="steps"
          withApprovals={false}
        />
      )}
      {cards.map((approval) => {
        const member = members.find((candidate) => candidate.runId === approval.runId);
        return (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            provider={member?.provider ?? ''}
            {...(member ? { agent: member.name } : {})}
            repo={repo}
          />
        );
      })}
    </>
  );
}
