import './workflow-card.css';
import { useQueries } from '@tanstack/react-query';
import {
  isTerminalRunStatus,
  type ConversationDetail,
  type WorkflowRun,
} from '@spark-outpost/contracts';
import { RunState } from '../../crew-flows/RunState.tsx';
import { NEEDS_YOU } from '../../crew-flows/run-model.ts';
import { workflowRunOfTurnQuery, useStopWorkflowRun } from '../../crew-flows/use-workflow-runs.ts';
import { BellIcon, WorkflowIcon, XIcon } from '../../ui/icons.tsx';
import { DockItem } from '../dock/DockItem.tsx';
import type { QuotesState } from '../quotes/use-quotes.ts';
import { GROUP_OVER } from '../pull-request/pr-card-model.ts';
import { useWorkflowCardFocus } from './card-focus.ts';
import { WorkflowPanel } from './WorkflowPanel.tsx';
import {
  cardTurnIds,
  currentStep,
  FIX_NOTE,
  findingQuote,
  pendingApprovals,
  runFindings,
  severityCounts,
  shownOnCard,
  stays,
  stepMembers,
  SEVERITY_WORDS,
  type RunFinding,
} from './workflow-card-model.ts';

interface CardEntry {
  turnRunId: string;
  run: WorkflowRun;
}

interface EntryProps {
  entry: CardEntry;
  detail: ConversationDetail;
  nested?: boolean;
  onFix: (finding: RunFinding) => void;
  onDismiss: (turnRunId: string) => void;
}

function Facts({
  run,
  waiting,
  step,
}: {
  run: WorkflowRun;
  waiting: boolean;
  step: string | null;
}) {
  return (
    <span className="prc-facts">
      {waiting && (
        <span className="prc-fact warn wfc-need">
          <BellIcon />
          {NEEDS_YOU}
        </span>
      )}
      {severityCounts(runFindings(run)).map(({ severity, count }) => (
        <span key={severity} className="wfc-sev" data-severity={severity}>
          {count} {SEVERITY_WORDS[severity]}
        </span>
      ))}
      {step && <span className="prc-fact plain">{step}</span>}
    </span>
  );
}

function WorkflowEntry({ entry, detail, nested = false, onFix, onDismiss }: EntryProps) {
  const focus = useWorkflowCardFocus();
  const stop = useStopWorkflowRun();
  const { run, turnRunId } = entry;
  const members = stepMembers(detail, turnRunId);
  const approvals = pendingApprovals(detail.approvals, members);
  const waiting = approvals.length > 0;
  const running = !isTerminalRunStatus(run.status);
  const name = `Workflow ${run.workflowName}`;
  return (
    <DockItem
      icon={<WorkflowIcon />}
      className={`prc-item wfc-item${nested ? ' nested' : ''}`}
      label={name}
      toggleLabel={`${name} details`}
      open={focus?.openTurn === turnRunId}
      onOpenChange={(open) => focus?.setOpenTurn(open ? turnRunId : null)}
      row={
        <>
          <span className="prc-title">{run.workflowName}</span>
          <RunState status={run.status} />
          <Facts run={run} waiting={waiting} step={currentStep(run, members)} />
        </>
      }
      trailing={
        running ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={stop.isPending}
            onClick={() => stop.mutate(run.id)}
          >
            Stop
          </button>
        ) : waiting ? null : (
          <button
            type="button"
            className="prc-x"
            aria-label={`Dismiss ${name}`}
            onClick={() => onDismiss(turnRunId)}
          >
            <XIcon />
          </button>
        )
      }
      panel={<WorkflowPanel run={run} members={members} approvals={approvals} onFix={onFix} />}
    />
  );
}

function groupLine(entries: readonly CardEntry[]): string {
  const running = entries.filter((entry) => !isTerminalRunStatus(entry.run.status)).length;
  const failed = entries.filter((entry) => entry.run.status === 'failed').length;
  const parts = [`${entries.length} workflow runs`];
  if (running > 0) parts.push(`${running} running`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

interface WorkflowCardProps {
  detail: ConversationDetail;
  quotes: Pick<QuotesState, 'add' | 'requestFocus'>;
}

export function WorkflowCard({ detail, quotes }: WorkflowCardProps) {
  const focus = useWorkflowCardFocus();
  const onFix = (finding: RunFinding) => {
    quotes.add({
      kind: 'comment',
      text: findingQuote(finding),
      note: FIX_NOTE,
      messageId: null,
      anchor: null,
    });
    quotes.requestFocus();
  };
  const turnIds = focus ? cardTurnIds(detail, focus.dismissed) : [];
  const runs = useQueries({
    queries: turnIds.map((turnRunId) => workflowRunOfTurnQuery(turnRunId)),
  });
  const entries = turnIds.flatMap((turnRunId, index): CardEntry[] => {
    const run = runs[index]?.data;
    if (!run || run.kind !== 'run') return [];
    const waiting = pendingApprovals(detail.approvals, stepMembers(detail, turnRunId)).length > 0;
    return shownOnCard(run, turnRunId, detail, waiting) ? [{ turnRunId, run }] : [];
  });
  if (entries.length === 0) return null;
  const onDismiss = (turnRunId: string) => {
    if (focus?.openTurn === turnRunId) focus.setOpenTurn(null);
    focus?.dismiss(turnRunId);
  };
  const grouped = entries.length > GROUP_OVER;
  const line = groupLine(entries);
  const groupOpen = entries.some((entry) => entry.turnRunId === focus?.openTurn);
  return (
    <section className="prc wfc" aria-label="Workflow runs">
      <p className="sr-only" role="status">
        {line}
      </p>
      {grouped ? (
        <DockItem
          icon={<WorkflowIcon />}
          className="prc-item group wfc-item"
          label={line}
          toggleLabel={`${line}, details`}
          {...(groupOpen ? { open: true } : {})}
          onOpenChange={(open) => {
            if (!open) focus?.setOpenTurn(null);
          }}
          row={<span className="prc-title">{line}</span>}
          trailing={
            entries.every((entry) => !stays(entry.run, false)) ? (
              <button
                type="button"
                className="prc-x"
                aria-label="Dismiss workflow runs"
                onClick={() => entries.forEach((entry) => onDismiss(entry.turnRunId))}
              >
                <XIcon />
              </button>
            ) : null
          }
          panel={entries.map((entry) => (
            <WorkflowEntry
              key={entry.turnRunId}
              entry={entry}
              detail={detail}
              nested
              onFix={onFix}
              onDismiss={onDismiss}
            />
          ))}
        />
      ) : (
        entries.map((entry) => (
          <WorkflowEntry
            key={entry.turnRunId}
            entry={entry}
            detail={detail}
            onFix={onFix}
            onDismiss={onDismiss}
          />
        ))
      )}
    </section>
  );
}
