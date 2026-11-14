import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  friendlyStep,
  holdsToConfirm,
  isCheckApproval,
  isWebToolTitle,
  parseMcpTool,
  type Approval,
  type ApprovalDecidedValue,
  type ApprovalScope,
  type Project,
} from '@spark-outpost/contracts';
import { approvalsApi } from '../../api/approvals.ts';
import { projectKeys } from '../../api/projects.ts';
import { HoldToConfirm } from '../../ui/HoldToConfirm.tsx';
import { Keys } from '../../ui/Keys.tsx';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { Breakout } from '../breakout/Breakout.tsx';
import { Markdown } from '../markdown/Markdown.tsx';
import { useProjectBranch } from '../project/use-chat-repos.ts';
import { useApprovalDetails } from './ApprovalDetails.tsx';
import { AlwaysAllow } from './AlwaysAllowMenu.tsx';
import { answerChoices } from './answer-choices.ts';
import { cardTitle } from './approval-title.ts';
import { ApprovalTitle } from './ApprovalTitle.tsx';
import { askerName } from './ask-reason.ts';
import { cardKeyAction, keyTarget } from './card-keys.ts';
import { CommandPreview } from './CommandPreview.tsx';
import { DiffCount, DiffFigure, DiffView } from './DiffView.tsx';
import { ObservedNote } from './ObservedNote.tsx';
import { useDiffModel } from './use-diff-model.ts';
import { useWaitingPlace } from './use-waiting-place.ts';
import { Button } from '../../ui/Button.tsx';

interface PendingApprovalProps {
  approval: Approval;
  agent: string;
  repo: Project | null;
  onDecided: (decided: ApprovalDecidedValue) => void;
}

const WORKTREE_SEGMENT = '/.spark/worktrees/';

function inWorktree(cwd: string | null): boolean {
  return cwd?.includes(WORKTREE_SEGMENT) ?? false;
}

function displayCwd(cwd: string | null, repo: Project | null): string | null {
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

function listed(files: readonly string[]): string {
  return files.join(', ');
}

function requestLine(approval: Approval, agent: string): string | null {
  const { payload } = approval;
  if (payload.plan) return `${agent} wrote a plan and wants to start building.`;
  if (isCheckApproval(approval)) return 'Jev wants to run a project check.';
  if (payload.forcePush) return `${agent} wants to rewrite history on the remote.`;
  if (payload.secretSend) {
    return `${agent} wants to send something that holds a value from ${listed(payload.secretSend)}.`;
  }
  if (payload.gitControl) return `${agent} wants to change ${listed(payload.gitControl)}.`;
  if (payload.instructionFiles) {
    return `${agent} wants to change ${listed(payload.instructionFiles)}, which steer every agent in this project.`;
  }
  return payload.subagent ? `Asked by ${agent}.` : null;
}

function otherSubject(approval: Approval): string | null {
  if (approval.kind === 'execute' || approval.kind === 'edit' || approval.payload.plan) return null;
  if (parseMcpTool(approval.title)) return null;
  return isWebToolTitle(approval.title) ? approval.title : friendlyStep(approval.title);
}

function releasedHint(approval: Approval): string {
  if (approval.payload.gitControl) return 'Released early. Nothing was changed.';
  if (approval.payload.forcePush) return 'Released early. Nothing was pushed.';
  return 'Released early. Nothing was sent.';
}

function useArrivalFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}

function EditDiffs({ approval, single }: { approval: Approval; single: boolean }) {
  const { diffs, paths } = approval.payload;
  if (diffs.length === 0) {
    return (
      <ul className="appr-paths">
        {paths.map((path) => (
          <li key={path}>
            <code title={fullPath(approval, path)}>{path}</code>
          </li>
        ))}
      </ul>
    );
  }
  if (single) return null;
  return diffs.map((diff) => (
    <DiffView key={diff.path} diff={diff} fullPath={fullPath(approval, diff.path)} />
  ));
}

export function PendingApproval({ approval, agent, repo, onDecided }: PendingApprovalProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const titleRef = useArrivalFocus();
  const place = useWaitingPlace(approval.id);
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
  const held = holdsToConfirm(approval.payload);
  const holdOption = held ? approval.options.find((option) => option.kind === 'allow_once') : null;
  const choices = answerChoices(approval);
  const { allow, deny } = choices;
  const busy = decide.isPending;
  const command = approval.payload.command;
  const plan = approval.payload.plan ?? null;
  const subjectLine = otherSubject(approval);
  const isEdit = approval.kind === 'edit';
  const singleDiff =
    isEdit && approval.payload.diffs.length === 1 ? approval.payload.diffs[0]! : null;
  const singleModel = useDiffModel(singleDiff?.oldText ?? null, singleDiff?.newText ?? '');
  const asker = askerName(approval, agent);
  const request = requestLine(approval, asker);
  const details = useApprovalDetails({
    approval,
    agent,
    cwd: displayCwd(approval.payload.cwd, repo),
    branch,
  });
  const answer = (optionId: string, scope: ApprovalScope = 'once') => {
    if (!busy) decide.mutate({ optionId, scope });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = cardKeyAction({
      key: event.key,
      modifier: event.metaKey || event.ctrlKey || event.altKey,
      shift: event.shiftKey,
      composing: event.nativeEvent.isComposing,
      handled: event.defaultPrevented,
      target: keyTarget(event.target, event.currentTarget),
      holds: held,
    });
    const option = action === 'allow' ? allow : action === 'deny' ? deny : undefined;
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    answer(option.optionId);
  };

  const meta = (
    <>
      {singleDiff && singleModel && <DiffCount model={singleModel} />}
      {place && <span className="appr-place">{place}</span>}
    </>
  );

  return (
    <Breakout>
      <div
        className="appr"
        role="group"
        aria-labelledby={headingId}
        id={approvalAnchor(approval.id)}
        onKeyDown={onKeyDown}
      >
        <ApprovalTitle
          ref={titleRef}
          approval={approval}
          title={cardTitle(approval)}
          headingId={headingId}
          meta={singleDiff || place ? meta : null}
        />
        {request && <p className="appr-sub">{request}</p>}
        {command && <CommandPreview command={command} />}
        {subjectLine && <CommandPreview command={subjectLine} />}
        {plan && (
          <div className="appr-plan" role="region" tabIndex={0} aria-label="Proposed plan">
            <Markdown text={plan} />
          </div>
        )}
        {singleDiff && (
          <DiffFigure
            diff={singleDiff}
            fullPath={fullPath(approval, singleDiff.path)}
            model={singleModel}
            counted
          />
        )}
        {isEdit && <EditDiffs approval={approval} single={singleDiff !== null} />}
        {approval.payload.truncated && <p>The diff was cut to 64 KB.</p>}
        {approval.reason !== null && (
          <p className="appr-reason">{approval.reason}, whatever your permissions.</p>
        )}
        <ObservedNote observed={approval.payload.observed} sendsTo={approval.payload.sendsTo} />
        {approval.payload.gitControl && (
          <p className="appr-reason">
            Git runs hooks and settings from .git on every commit, outside Spark&apos;s control and
            approvals. Allow this once only if you have read the change.
          </p>
        )}
        {holdOption && (
          <HoldToConfirm
            label={approval.payload.forcePush ? 'Hold to force push' : 'Hold to allow once'}
            hint="Press and hold for 1.5 seconds, with the mouse or Space."
            holdingHint="Keep holding. Let go now to cancel."
            releasedHint={releasedHint(approval)}
            disabled={busy}
            onConfirm={() => answer(holdOption.optionId)}
          />
        )}
        <div className="appr-acts">
          {allow && (
            <Button
              tone="soft"
              small
              aria-keyshortcuts="Enter"
              disabled={busy || Boolean(allow.unavailableReason)}
              title={allow.unavailableReason}
              onClick={() => answer(allow.optionId)}
            >
              {choices.allowLabel}
              <Keys keys={['⏎']} className="key-hint" />
            </Button>
          )}
          <AlwaysAllow
            choices={choices.always}
            disabled={busy}
            onChoose={(choice) => answer(choice.optionId, choice.scope)}
          />
          {deny && (
            <button
              type="button"
              className="btn line sm deny"
              aria-keyshortcuts="Escape"
              disabled={busy}
              onClick={() => answer(deny.optionId)}
            >
              {deny.name}
              <Keys keys={['Esc']} className="key-hint" />
            </button>
          )}
          {choices.otherRejects.map((option) => (
            <button
              key={option.optionId}
              type="button"
              className="btn ghost sm deny"
              disabled={busy}
              onClick={() => answer(option.optionId)}
            >
              {option.name}
            </button>
          ))}
          {details.toggle}
        </div>
        {details.panel}
        {decide.isError && (
          <p className="appr-err" role="alert">
            {decide.error.message}
          </p>
        )}
      </div>
    </Breakout>
  );
}
