import './approval-card.css';
import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  commandSandboxNote,
  isCheckApproval,
  type Approval,
  type ApprovalDecidedValue,
  type ApprovalOption,
  type ApprovalScope,
  type Project,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { projectKeys } from '../../api/projects.ts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { providerName } from '../provider-name.ts';
import { useProjectBranch } from '../project/use-chat-repos.ts';
import { mergeDecision } from './approval-events.ts';
import { DiffView } from './DiffView.tsx';

interface ApprovalCardProps {
  approval: Approval;
  provider: string;
  agent?: string;
  repo: Project | null;
}

function allowOption(options: readonly ApprovalOption[]) {
  return (
    options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind === 'allow_always')
  );
}

function rejectOption(options: readonly ApprovalOption[]) {
  return (
    options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always')
  );
}

export function displayCwd(cwd: string | null, repo: Project | null): string | null {
  if (!cwd) return repo?.displayPath ?? null;
  if (repo && (cwd === repo.rootPath || cwd.startsWith(`${repo.rootPath}/`))) {
    return `${repo.displayPath}${cwd.slice(repo.rootPath.length)}`;
  }
  return cwd;
}

function fullPath(approval: Approval, shown: string): string | undefined {
  const index = approval.payload.paths.indexOf(shown);
  return index < 0 ? undefined : approval.payload.fullPaths?.[index];
}

function heading(approval: Approval): string {
  if (approval.payload.plan) return 'Approve the plan?';
  if (isCheckApproval(approval)) return 'Run a check?';
  if (approval.kind === 'execute') return 'Run a command?';
  if (approval.kind === 'edit') {
    return approval.payload.paths.length > 1 ? 'Change these files?' : 'Change a file?';
  }
  return 'Allow this action?';
}

function request(approval: Approval, agent: string) {
  if (approval.payload.plan) return `${agent} wrote a plan and wants to start building.`;
  if (isCheckApproval(approval)) return 'Jev wants to run a project check.';
  if (approval.kind === 'execute') return `${agent} wants to run a command.`;
  if (approval.kind === 'edit') {
    const paths = approval.payload.paths;
    return paths.length === 0 ? `${agent} wants to change files.` : `${agent} wants to edit:`;
  }
  return `${agent} wants to: ${approval.title}`;
}

function planOutcome(approval: Approval): { icon: 'ok' | 'no'; label: string; detail: string } {
  if (approval.status === 'allowed') {
    return { icon: 'ok', label: 'Plan approved.', detail: 'Saved as the agreed plan.' };
  }
  if (approval.status === 'denied') {
    return { icon: 'no', label: 'Kept planning.', detail: 'The agent can revise the plan.' };
  }
  return outcome({ ...approval, payload: { ...approval.payload, plan: undefined } });
}

function outcome(approval: Approval): { icon: 'ok' | 'no'; label: string; detail: string } {
  if (approval.payload.plan) return planOutcome(approval);
  const command = approval.kind === 'execute';
  switch (approval.status) {
    case 'allowed':
      if (approval.scope === 'run')
        return { icon: 'ok', label: 'Allowed for this run.', detail: '' };
      if (approval.scope === 'project') {
        return {
          icon: 'ok',
          label: 'Always allowed in this project.',
          detail: 'Added to the allowlist.',
        };
      }
      return { icon: 'ok', label: 'Allowed once.', detail: '' };
    case 'denied':
      return {
        icon: 'no',
        label: 'Denied.',
        detail: command ? "The command didn't run." : "The change wasn't made.",
      };
    case 'cancelled':
      return { icon: 'no', label: 'Cancelled.', detail: 'The run stopped before you answered.' };
    case 'expired':
      return {
        icon: 'no',
        label: 'Expired.',
        detail:
          approval.decidedBy === 'recovery'
            ? 'The run stopped unexpectedly, so the action never ran.'
            : 'Nobody answered within 30 minutes, so it was declined.',
      };
    default:
      return { icon: 'ok', label: '', detail: '' };
  }
}

export function ApprovalCard({ approval: incoming, provider, agent, repo }: ApprovalCardProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const [local, setLocal] = useState<ApprovalDecidedValue | null>(null);
  const approval = local ? mergeDecision([incoming], local)[0]! : incoming;
  const branch = useProjectBranch(repo?.id ?? null);
  const decide = useMutation({
    mutationFn: ({ optionId, scope }: { optionId: string; scope: ApprovalScope }) =>
      approvalsApi.decide(approval.id, { optionId, scope, payloadHash: approval.payloadHash }),
    onSuccess: (decided, { scope }) => {
      setLocal(decided);
      if (scope === 'project') void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
  const pending = approval.status === 'pending';
  const allow = allowOption(approval.options);
  const reject = rejectOption(approval.options);
  const alwaysAsks = approval.reason !== null;
  const command = approval.payload.command;
  const plan = approval.payload.plan ?? null;
  const cwd = displayCwd(approval.payload.cwd, repo);
  const result = outcome(approval);
  const className = [
    'appr',
    pending ? '' : 'decided',
    approval.status === 'denied' || approval.status === 'expired' ? 'denied' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      <div className="appr-h">
        <span className="ic" aria-hidden="true">
          <i className={pending ? 'appr-dia' : 'appr-dia still'} />
        </span>
        <span id={headingId}>
          <b>{heading(approval)}</b> {request(approval, agent ?? providerName(provider))}
        </span>
      </div>
      {command && <pre className="appr-cmd">$ {command}</pre>}
      {plan && (
        <div className="appr-plan" tabIndex={0} aria-label="Proposed plan">
          <Markdown text={plan} />
        </div>
      )}
      {approval.kind === 'edit' && approval.payload.diffs.length > 0
        ? approval.payload.diffs.map((diff) => (
            <DiffView key={diff.path} diff={diff} fullPath={fullPath(approval, diff.path)} />
          ))
        : approval.kind === 'edit' && (
            <ul className="appr-paths">
              {approval.payload.paths.map((path) => (
                <li key={path}>
                  <code title={fullPath(approval, path)}>{path}</code>
                </li>
              ))}
            </ul>
          )}
      {approval.payload.truncated && <p>The diff was cut to 64 KB.</p>}
      {approval.kind === 'execute' && (
        <p>
          {cwd && (
            <>
              Runs in <code>{cwd}</code>
              {branch && (
                <>
                  {' '}
                  on <code>{branch}</code>
                </>
              )}
              .{' '}
            </>
          )}
          {commandSandboxNote(provider)}
          {alwaysAsks ? '.' : ", and this one isn't on the project's allowlist yet."}
        </p>
      )}
      {approval.kind === 'edit' && (
        <p>The change lands in your working tree. You can revert this run afterwards.</p>
      )}
      {alwaysAsks && (
        <p className="appr-reason">{approval.reason}, whatever your involvement level.</p>
      )}
      {pending ? (
        <div className="appr-acts">
          {allow && (
            <button
              type="button"
              className="btn primary sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ optionId: allow.optionId, scope: 'once' })}
            >
              {plan ? 'Approve plan' : 'Allow'}
            </button>
          )}
          {allow && !alwaysAsks && !plan && (
            <button
              type="button"
              className="btn line sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ optionId: allow.optionId, scope: 'run' })}
            >
              Allow for this run
            </button>
          )}
          {allow && !alwaysAsks && approval.kind === 'execute' && command && (
            <button
              type="button"
              className="btn line sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ optionId: allow.optionId, scope: 'project' })}
            >
              Always allow in this project
            </button>
          )}
          {reject && (
            <button
              type="button"
              className="btn ghost sm deny"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ optionId: reject.optionId, scope: 'once' })}
            >
              {plan ? 'Keep planning' : 'Deny'}
            </button>
          )}
        </div>
      ) : (
        <div className="appr-res" role="status">
          {result.icon === 'ok' ? <CheckIcon /> : <XIcon />}
          <b>{result.label}</b>
          {result.detail}
        </div>
      )}
      {decide.isError && (
        <p className="appr-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
