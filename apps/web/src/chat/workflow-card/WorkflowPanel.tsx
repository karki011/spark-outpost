import { useState } from 'react';
import type { Approval, CrewMember, WorkflowRun } from '@spark-outpost/contracts';
import { formatDuration } from '../../audit/audit-model.ts';
import { OpenRunViewButton } from '../../crew-flows/WorkflowRunLink.tsx';
import { StepState } from '../../crew-flows/StepState.tsx';
import { formatCost } from '../../usage/format.ts';
import { focusPending } from '../status/focus-pending.ts';
import { isBlocking, runFindings, SEVERITY_WORDS, type RunFinding } from './workflow-card-model.ts';

interface FindingRowProps {
  finding: RunFinding;
  onFix: (finding: RunFinding) => void;
}

function FindingRow({ finding, onFix }: FindingRowProps) {
  return (
    <li className="wfc-finding">
      <span className="wfc-sev" data-severity={finding.severity}>
        {SEVERITY_WORDS[finding.severity]}
      </span>
      <span className="wfc-finding-text">{finding.text}</span>
      <button
        type="button"
        className="btn line sm"
        aria-label={`Fix: ${finding.text}`}
        onClick={() => onFix(finding)}
      >
        Fix
      </button>
    </li>
  );
}

function Findings({ run, onFix }: { run: WorkflowRun; onFix: (finding: RunFinding) => void }) {
  const [all, setAll] = useState(false);
  const findings = runFindings(run);
  if (findings.length === 0) return null;
  const blocking = findings.filter((finding) => isBlocking(finding.severity));
  const shown = all || blocking.length === 0 ? findings : blocking;
  const hidden = findings.length - shown.length;
  return (
    <div className="wfc-findings">
      <ul aria-label="Findings">
        {shown.map((finding, index) => (
          <FindingRow key={`${finding.stepId}-${index}`} finding={finding} onFix={onFix} />
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="btn ghost sm" onClick={() => setAll(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

function StepLine({
  member,
  run,
}: {
  member: CrewMember | undefined;
  run: WorkflowRun['steps'][number];
}) {
  const facts = [
    member?.durationMs != null ? formatDuration(member.durationMs) : null,
    member?.costUsd != null ? formatCost(member.costUsd) : null,
  ].filter(Boolean);
  return (
    <li className="wfc-step">
      <StepState state={run.state} />
      <b>{member?.name ?? run.stepId}</b>
      {facts.length > 0 && <span>{facts.join(' · ')}</span>}
      {run.state === 'failed' && run.note && <p className="wfc-step-note">{run.note}</p>}
    </li>
  );
}

interface WorkflowPanelProps {
  run: WorkflowRun;
  members: readonly CrewMember[];
  approvals: readonly Approval[];
  onFix: (finding: RunFinding) => void;
}

export function WorkflowPanel({ run, members, approvals, onFix }: WorkflowPanelProps) {
  const memberOf = (runId: string | null) => members.find((member) => member.runId === runId);
  return (
    <div className="wfc-panel">
      {approvals.map((approval) => (
        <p key={approval.id} className="wfc-ask">
          <span>
            <b>{memberOf(approval.runId)?.name ?? 'A step'}</b> asks: {approval.title}
          </span>
          <button type="button" className="btn line sm" onClick={() => focusPending(approval.id)}>
            Go to the card
          </button>
        </p>
      ))}
      <Findings run={run} onFix={onFix} />
      <ul className="wfc-steps" aria-label="Steps">
        {run.steps.map((step) => (
          <StepLine key={step.stepId} member={memberOf(step.runId)} run={step} />
        ))}
      </ul>
      <p className="wfc-foot">
        <OpenRunViewButton run={run} quiet />
      </p>
    </div>
  );
}
