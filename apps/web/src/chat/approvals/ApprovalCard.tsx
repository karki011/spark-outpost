import './approval-card.css';
import { Fragment, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  commandSandboxNote,
  isCheckApproval,
  sparkActionLabels,
  type Approval,
  type ApprovalDecidedValue,
  type ApprovalScope,
  type Project,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { projectKeys } from '../../api/projects.ts';
import { HoldToConfirm } from '../../ui/HoldToConfirm.tsx';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { providerName } from '../provider-name.ts';
import { useProjectBranch } from '../project/use-chat-repos.ts';
import { mergeDecision } from './approval-events.ts';
import { isAllow, outcome, projectAllowOption, shownOptions } from './approval-outcome.ts';
import { DiffView } from './DiffView.tsx';
import { SparkActionCard } from './SparkActionCard.tsx';

interface ApprovalCardProps {
  approval: Approval;
  provider: string;
  agent?: string;
  repo: Project | null;
}

const WORKTREE_SEGMENT = '/.spark/worktrees/';

function inWorktree(cwd: string | null): boolean {
  return cwd?.includes(WORKTREE_SEGMENT) ?? false;
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
  const action = approval.payload.sparkAction;
  if (action) return sparkActionLabels[action.action].question;
  if (approval.payload.plan) return 'Approve the plan?';
  if (approval.payload.forcePush) return 'Force push?';
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
  if (approval.payload.forcePush) return `${agent} wants to rewrite history on the remote.`;
  if (approval.kind === 'execute') return `${agent} wants to run a command.`;
  if (approval.kind === 'edit') {
    const paths = approval.payload.paths;
    return paths.length === 0 ? `${agent} wants to change files.` : `${agent} wants to edit:`;
  }
  return `${agent} wants to: ${approval.title}`;
}

function commandNoteEnding(approval: Approval): string {
  if (approval.reason !== null) return '.';
  if (approval.payload.asksBecause) return `. ${approval.payload.asksBecause}.`;
  return ", and this one isn't on the project's allowlist yet.";
}

function optionClass(allow: boolean, primary: boolean): string {
  if (!allow) return 'btn ghost sm deny';
  return primary ? 'btn primary sm' : 'btn line sm';
}

function subject(approval: Approval): string | null {
  if (approval.payload.sparkAction) return approval.title;
  if (approval.payload.plan) return null;
  if (approval.payload.command) return approval.payload.command;
  if (approval.payload.paths.length > 0) return approval.payload.paths.join(', ');
  return approval.kind === 'edit' ? null : approval.title;
}

function ResolvedApproval({ approval }: { approval: Approval }) {
  const headingId = useId();
  const result = outcome(approval);
  const shown = subject(approval);
  const denied = result.icon === 'no';
  return (
    <div
      className={denied ? 'appr resolved denied' : 'appr resolved'}
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      <span className="ic" aria-hidden="true">
        {denied ? <XIcon /> : <CheckIcon />}
      </span>
      <span id={headingId} className="appr-what">
        <b>{heading(approval)}</b>
        {shown && <code title={shown}>{shown}</code>}
      </span>
      <span className="appr-res" role="status">
        <b>{result.label}</b>
        {result.detail}
      </span>
    </div>
  );
}

export function ApprovalCard({ approval: incoming, ...rest }: ApprovalCardProps) {
  const [local, setLocal] = useState<ApprovalDecidedValue | null>(null);
  const approval = local ? mergeDecision([incoming], local)[0]! : incoming;
  if (approval.status !== 'pending') return <ResolvedApproval approval={approval} />;
  if (approval.payload.sparkAction) {
    return (
      <SparkActionCard
        approval={approval}
        agent={rest.agent ?? providerName(rest.provider)}
        onDecided={setLocal}
      />
    );
  }
  return <PendingApproval approval={approval} onDecided={setLocal} {...rest} />;
}

function PendingApproval({
  approval,
  provider,
  agent,
  repo,
  onDecided,
}: ApprovalCardProps & { onDecided: (decided: ApprovalDecidedValue) => void }) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const checkoutBranch = useProjectBranch(repo?.id ?? null);
  const branch = inWorktree(approval.payload.cwd) ? null : checkoutBranch;
  const decide = useMutation({
    mutationFn: ({ optionId, scope }: { optionId: string; scope: ApprovalScope }) =>
      approvalsApi.decide(approval.id, { optionId, scope, payloadHash: approval.payloadHash }),
    onSuccess: (decided, { scope }) => {
      onDecided(decided);
      if (scope === 'project') void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
  const forced = approval.payload.forcePush !== undefined;
  const holdOption = forced
    ? approval.options.find((option) => option.kind === 'allow_once')
    : null;
  const options = shownOptions(approval).filter((option) => !forced || !isAllow(option));
  const firstAllow = options.findIndex(isAllow);
  const lastAllow = options.findLastIndex(isAllow);
  const alwaysAsks = approval.reason !== null;
  const command = approval.payload.command;
  const plan = approval.payload.plan ?? null;
  const cwd = displayCwd(approval.payload.cwd, repo);
  const projectAllow =
    !alwaysAsks && !plan && approval.kind === 'execute' && command
      ? projectAllowOption(approval.options)
      : undefined;

  return (
    <div className="appr" role="group" aria-labelledby={headingId} id={approvalAnchor(approval.id)}>
      <div className="appr-h">
        <span className="ic" aria-hidden="true">
          <i className="appr-dia" />
        </span>
        <span id={headingId}>
          <b>{heading(approval)}</b> {request(approval, agent ?? providerName(provider))}
        </span>
      </div>
      {command && <pre className="appr-cmd">$ {command}</pre>}
      {plan && (
        <div className="appr-plan" role="region" tabIndex={0} aria-label="Proposed plan">
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
          {commandNoteEnding(approval)}
        </p>
      )}
      {approval.kind === 'edit' && (
        <p>The change lands in your working tree. You can revert this run afterwards.</p>
      )}
      {alwaysAsks && <p className="appr-reason">{approval.reason}, whatever your permissions.</p>}
      {holdOption && (
        <HoldToConfirm
          label="Hold to force push"
          hint="Press and hold for 1.5 seconds, with the mouse or Space."
          holdingHint="Keep holding. Let go now to cancel."
          releasedHint="Released early. Nothing was pushed."
          disabled={decide.isPending}
          onConfirm={() => decide.mutate({ optionId: holdOption.optionId, scope: 'once' })}
        />
      )}
      <div className="appr-acts">
        {options.map((option, index) => (
          <Fragment key={option.optionId}>
            <button
              type="button"
              className={optionClass(isAllow(option), index === firstAllow)}
              disabled={decide.isPending || Boolean(option.unavailableReason)}
              title={option.unavailableReason}
              onClick={() => decide.mutate({ optionId: option.optionId, scope: 'once' })}
            >
              {option.name}
            </button>
            {index === lastAllow && projectAllow && (
              <button
                type="button"
                className="btn line sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ optionId: projectAllow.optionId, scope: 'project' })}
              >
                Always allow in this project
              </button>
            )}
          </Fragment>
        ))}
      </div>
      {decide.isError && (
        <p className="appr-err" role="alert">
          {decide.error.message}
        </p>
      )}
    </div>
  );
}
